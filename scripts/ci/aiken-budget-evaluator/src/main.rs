use std::io::{self, Read};
use uplc::{ast::Program, machine::cost_model::ExBudget, PlutusData};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    compiled_code: String,
    arguments_cbor: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Measurement {
    execution_units: ExBudget,
    diagnostic_budget: ExBudget,
}

fn evaluate(input: Input) -> Result<Measurement, Box<dyn std::error::Error>> {
    let mut program = Program::<uplc::ast::DeBruijn>::from_hex(
        &input.compiled_code,
        &mut Vec::new(),
        &mut Vec::new(),
    )?;
    let arguments = uplc::plutus_data(&hex::decode(input.arguments_cbor)?)?;
    let PlutusData::Array(arguments) = arguments else {
        return Err("script arguments must be a Plutus Data list".into());
    };
    for argument in arguments.iter() {
        program = program.apply_data(argument.clone());
    }

    // Diagnostic ceiling only, so oversized fixtures finish. This is not a
    // transaction limit and does not establish ledger admissibility.
    let diagnostic_budget = ExBudget::max();
    let result = program.eval(diagnostic_budget);
    let term = result
        .result()
        .map_err(|err| format!("script failed: {err}"))?;
    if !term.is_unit() {
        return Err("production Plutus V3 validator did not return unit".into());
    }
    Ok(Measurement {
        execution_units: result.cost(),
        diagnostic_budget,
    })
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let measurement = evaluate(serde_json::from_str(&input)?)?;
    println!("{}", serde_json::to_string(&measurement)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(body: &str, arguments: &str) -> Input {
        let program = uplc::parser::program(body).unwrap().to_debruijn().unwrap();
        Input {
            compiled_code: hex::encode(program.to_cbor().unwrap()),
            arguments_cbor: arguments.into(),
        }
    }

    #[test]
    fn measures_the_applied_program() {
        let measurement = evaluate(input(
            "(program 1.1.0 (lam context (con unit ())))",
            "9fd87980ff",
        ))
        .unwrap();
        assert!(measurement.execution_units.mem > 0);
        assert!(measurement.execution_units.cpu > 0);
        assert_eq!(measurement.diagnostic_budget, ExBudget::max());
    }

    #[test]
    fn rejects_failures_unapplied_functions_and_non_unit_results() {
        for (program, arguments) in [
            ("(program 1.1.0 (lam context (error)))", "9fd87980ff"),
            ("(program 1.1.0 (lam context (con unit ())))", "80"),
            (
                "(program 1.1.0 (lam context (con bool False)))",
                "9fd87980ff",
            ),
            ("(program 1.1.0 (con unit ()))", "d87980"),
        ] {
            assert!(evaluate(input(program, arguments)).is_err());
        }
    }
}
