import { AikenType } from "./types.ts";
import { GenType, ImportMap } from "./types.ts";
import { builtInTypes } from "./const.ts";
import { getPointer, insertDependencies } from "./utils.ts";
import { PlutusDefinition } from "./types.ts";

export function generateType(
  plutusDefinition: PlutusDefinition,
  typeDef: AikenType,
): GenType {
  const path = typeDef.path;

  if (path in builtInTypes) {
    return builtInTypes[typeDef.path];
  }

  if ("dataType" in typeDef) {
    if (typeDef.dataType == "list" && "items" in typeDef) {
      const listType = getPointer(
        plutusDefinition,
        typeDef.items.$ref,
      );

      const genType = generateType(plutusDefinition, listType);

      if (genType.type === "primitive") {
        return {
          type: "composite",
          dependencies: new Map(),
          schema: [`Data.Array(${genType.schema})`],
        };
      } else if (genType.type === "composite") {
        return {
          type: "composite",
          dependencies: new Map([...genType.dependencies]),
          schema: ["Data.Array(", ...genType.schema, ")"],
        };
      } else if (genType.type === "custom") {
        const importId = genType.name + "Schema";
        return {
          type: "composite",
          dependencies: new Map([[importId, {
            content: importId,
            path: genType.path,
          }]]),
          schema: ["Data.Array(", importId, ")"],
        };
      } else {
        throw new Error("list.item GenType.type not implemented yet");
      }
    }

    if (typeDef.dataType == "map" && "keys" in typeDef && "values" in typeDef) {
      let dependencies: ImportMap = new Map();

      const keyType = getPointer(plutusDefinition, typeDef.keys.$ref);
      const genKeyType = generateType(plutusDefinition, keyType);
      let keySchema: string[];

      if (genKeyType.type === "primitive") {
        keySchema = genKeyType.schema;
      } else if (genKeyType.type === "composite") {
        const [updatedDeps, updatedSchema] = insertDependencies(
          dependencies,
          genKeyType.dependencies,
          genKeyType.schema,
        );
        dependencies = updatedDeps;
        keySchema = updatedSchema;
      } else if (genKeyType.type === "custom") {
        const importId = genKeyType.name + "Schema";
        const [updatedDeps, updatedSchema] = insertDependencies(
          dependencies,
          new Map([[importId, { content: importId, path: genKeyType.path }]]),
          [importId],
        );
        dependencies = updatedDeps;
        keySchema = updatedSchema;
      } else {
        throw new Error("map.key GenType.type not implemented yet");
      }

      const valType = getPointer(plutusDefinition, typeDef.values.$ref);
      const genValType = generateType(plutusDefinition, valType);
      let valSchema: string[];

      if (genValType.type === "primitive") {
        valSchema = genValType.schema;
      } else if (genValType.type === "composite") {
        const [updatedDeps, updatedSchema] = insertDependencies(
          dependencies,
          genValType.dependencies,
          genValType.schema,
        );
        dependencies = updatedDeps;
        valSchema = updatedSchema;
      } else if (genValType.type === "custom") {
        const importId = genValType.name + "Schema";
        const [updatedDeps, updatedSchema] = insertDependencies(
          dependencies,
          new Map([[importId, { content: importId, path: genValType.path }]]),
          [importId],
        );
        dependencies = updatedDeps;
        valSchema = updatedSchema;
      } else {
        throw new Error("map.value GenType.type not implemented yet");
      }

      return {
        type: "composite",
        dependencies,
        schema: ["Data.Map(", ...keySchema, ",", ...valSchema, ")"],
      };
    }

    if (typeDef.dataType == "constructor" && "fields" in typeDef) {
      const fields = typeDef.fields as {
        $ref: string;
      }[];

      if (fields.length > 0) {
        if ("title" in fields[0]) {
          let dependencies = new Map();
          const schema: string[] = [];

          fields.forEach((cur) => {
            if (!("title" in cur) || typeof cur.title != "string") {
              throw new Error("title can not be undefined in Object field");
            }

            const listType = getPointer(plutusDefinition, cur.$ref);
            const genType = generateType(plutusDefinition, listType);

            if (genType.type == "primitive") {
              schema.push(`${cur.title}: ${genType.schema},`);
              return;
            }

            if (genType.type == "composite") {
              const [updatedDeps, updatedSchema] = insertDependencies(
                dependencies,
                genType.dependencies,
                genType.schema,
              );
              dependencies = updatedDeps;
              schema.push(`${cur.title}:`, ...updatedSchema, ",");
              return;
            }

            if (genType.type == "custom") {
              const importId = genType.name + "Schema";

              const [updatedDeps, updatedSchema] = insertDependencies(
                dependencies,
                new Map([[importId, {
                  content: importId,
                  path: genType.path,
                }]]),
                [importId],
              );
              dependencies = updatedDeps;
              schema.push(`${cur.title}:`, ...updatedSchema, ",");
              return;
            }

            throw new Error("GenType.type not implemented yet");
          });

          return {
            type: "composite",
            dependencies,
            schema: ["Data.Object({", ...schema, "})"],
          };
        } else {
          let dependencies = new Map();
          const schema: string[] = [];

          fields.forEach((cur) => {
            const listType = getPointer(plutusDefinition, cur.$ref);
            const genType = generateType(plutusDefinition, listType);

            if (genType.type === "primitive") {
              schema.push(...genType.schema, ",");
            } else if (genType.type === "composite") {
              const [updatedDeps, updatedSchema] = insertDependencies(
                dependencies,
                genType.dependencies,
                genType.schema,
              );
              dependencies = updatedDeps;
              schema.push(...updatedSchema, ",");
            } else if (genType.type === "custom") {
              const importId = genType.name + "Schema";

              const [updatedDeps, updatedSchema] = insertDependencies(
                dependencies,
                new Map([[importId, {
                  content: importId,
                  path: genType.path,
                }]]),
                [importId],
              );
              dependencies = updatedDeps;
              schema.push(...updatedSchema, ",");
            } else {
              throw new Error("GenType.type not implemented yet");
            }
          });

          return {
            type: "composite",
            dependencies,
            schema: ["Data.Tuple([", ...schema, "])"],
          };
        }
      } else {
        if (!("title" in typeDef)) {
          throw new Error("title can not be undefined with Literal");
        }

        return {
          type: "primitive",
          schema: [`Data.Literal("${typeDef.title}"),`],
        };
      }
    }
  }

  if ("anyOf" in typeDef) {
    if (typeDef.anyOf.length == 1) {
      let forwardTitle = typeDef.anyOf[0].dataType == "constructor" && !("title" in typeDef.anyOf[0])
      let forwardItem = typeDef.anyOf[0];
      if (forwardTitle) {
        forwardItem.title = typeDef.title;
      }
      const genType = generateType(
        plutusDefinition,
        forwardItem as unknown as AikenType,
      );

      if (genType.type != "composite") {
        throw new Error("GenType.type must be composite");
      }

      const dependencies: ImportMap = new Map([
        ["Data", {
          content: "Data",
          path: "npm:@lucid-evolution/lucid@0.3.51",
        }],
      ]);

      genType.dependencies.forEach((value, key) => {
        dependencies.set(key, value);
      });

      return {
        type: "custom",
        path: typeDef.path,
        name: typeDef.title,
        imports: dependencies,
        schema: genType.schema,
      };
    } else if (typeDef.title === "Optional" && typeDef.anyOf.length == 2) {
      const someDef = typeDef.anyOf[0];

      if (
        someDef.dataType !== "constructor" || !("title" in someDef) ||
        someDef.title != "Some" || someDef.fields.length !== 1
      ) {
        throw new Error("Invalid type definition for Option.Some ");
      }

      const someType = getPointer(
        plutusDefinition,
        typeDef.anyOf[0].fields[0].$ref,
      );
      const genType = generateType(plutusDefinition, someType);

      if (genType.type === "primitive") {
        return {
          type: "composite",
          dependencies: new Map(),
          schema: [`Data.Nullable(${genType.schema.join("")})`],
        };
      } else if (genType.type === "composite") {
        return {
          type: "composite",
          dependencies: new Map([...genType.dependencies]),
          schema: ["Data.Nullable(", ...genType.schema, ")"],
        };
      } else if (genType.type === "custom") {
        const importId: string = genType.name + "Schema";
        return {
          type: "composite",
          dependencies: new Map([[importId, {
            content: importId,
            path: genType.path,
          }]]),
          schema: ["Data.Nullable(", importId, ")"],
        };
      } else {
        throw new Error("Option.Some.value GenType.type not implemented yet");
      }
    } else {
      let dependencies: ImportMap = new Map([
        ["Data", {
          content: "Data",
          path: "npm:@lucid-evolution/lucid@0.3.51",
        }],
      ]);
      const schema: string[] = [];

      typeDef.anyOf.forEach((t) => {
        if (!("title" in t)) {
          throw new Error(`Enum ${typeDef.title} variant title not found`);
        }

        const genType = generateType(
          plutusDefinition,
          t as unknown as AikenType,
        );

        if (genType.type === "primitive") {
          schema.push(...genType.schema);
        } else if (genType.type === "composite") {
          genType.dependencies.forEach((value, key) => {
            dependencies.set(key, value);
          });

          schema.push(
            "Data.Object({",
            t.title,
            ":",
            ...genType.schema,
            "}),",
          );

          const [updatedDeps, updatedSchema] = insertDependencies(
            dependencies,
            genType.dependencies,
            genType.schema,
          );

          dependencies = updatedDeps;
          schema.push(
            "Data.Object({",
            t.title,
            ":",
            ...updatedSchema,
            "}),",
          );
        } else {
          throw new Error(
            `Enum variant ${t.title} GenType.type ${genType.type} not implemented yet`,
          );
        }
      });

      return {
        type: "custom",
        path: typeDef.path,
        name: typeDef.title,
        imports: dependencies,
        schema: ["Data.Enum([", ...schema, "])"],
      };
    }
  }

  throw new Error("Type is not recognized");
}
