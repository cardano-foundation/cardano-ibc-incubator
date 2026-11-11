import { assertEquals } from "@std/assert";
import { Archive, fullRoot } from "./frontier.ts";

const counts = [
  0,
  1,
  2,
  3,
  7,
  8,
  31,
  32,
  100,
  255,
  256,
  4095,
  4096,
  5999,
  6000,
];
const archive = new Archive();
const vectors = [];
for (let count = 0; count <= 6000; count++) {
  const value = count.toString(16).padStart(16, "0");
  if (counts.includes(count)) {
    assertEquals(archive.root().slice(18), fullRoot(archive.values));
    const root = archive.root();
    const frontier = [...archive.peaks];
    const memberships = [...new Set([0, Math.floor(count / 2), count - 1])]
      .filter((index) => index >= 0 && index < count)
      .map((position) => ({
        position,
        value: archive.values[position],
        path: archive.proof(position),
      }));
    archive.append(value);
    assertEquals(archive.root().slice(18), fullRoot(archive.values));
    vectors.push({
      count,
      root,
      frontier,
      value,
      next: archive.root(),
      memberships,
    });
  } else {
    archive.append(value);
  }
}

const bytes = (value: string) => `#"${value}"`;
const list = (values: string[]) => `[${values.map(bytes).join(", ")}]`;
let source =
  `use ibc/client/ics_007_tendermint_client/experimental_history as archive\n`;
for (const vector of vectors) {
  source += `test append_${vector.count}() { archive.append(${
    bytes(vector.root)
  }, ${bytes(vector.value)}, ${list(vector.frontier)}) == ${
    bytes(vector.next)
  } }\n`;
  for (const witness of vector.memberships) {
    source +=
      `test include_${vector.count}_${witness.position}() { archive.authenticate(${
        bytes(vector.root)
      }, ${witness.position}, ${bytes(witness.value)}, ${
        list(witness.path)
      }) }\n`;
  }
}
const three = vectors.find((vector) => vector.count === 3)!;
const wrong = "ff".repeat(32);
const rejection = (name: string, expression: string) => {
  source += `test ${name}() fail { ${expression}${
    expression.startsWith("archive.append") ? ' != #""' : ""
  } }\n`;
};
rejection(
  "reject_legacy_root",
  `archive.append(${bytes("00".repeat(32))}, #"00", [])`,
);
rejection(
  "reject_unknown_version",
  `archive.append(${bytes("03" + three.root.slice(2))}, #"00", ${
    list(three.frontier)
  })`,
);
rejection(
  "reject_truncated_root",
  `archive.append(${bytes(three.root.slice(2))}, #"00", ${
    list(three.frontier)
  })`,
);
rejection(
  "reject_missing_peak",
  `archive.append(${bytes(three.root)}, #"00", ${
    list(three.frontier.slice(1))
  })`,
);
rejection(
  "reject_extra_peak",
  `archive.append(${bytes(three.root)}, #"00", ${
    list([...three.frontier, wrong])
  })`,
);
rejection(
  "reject_reordered_peaks",
  `archive.append(${bytes(three.root)}, #"00", ${
    list([...three.frontier].reverse())
  })`,
);
rejection(
  "reject_forged_peak",
  `archive.append(${bytes(three.root)}, #"00", ${
    list([wrong, three.frontier[1]])
  })`,
);
rejection(
  "reject_short_peak",
  `archive.append(${bytes(three.root)}, #"00", ${
    list(["ff", three.frontier[1]])
  })`,
);
rejection(
  "reject_nonempty_frontier_for_empty_root",
  `archive.append(archive.empty_root, #"00", [${bytes(wrong)}])`,
);
rejection(
  "reject_count_overflow",
  `archive.append(${bytes("02" + "ff".repeat(8) + wrong)}, #"00", [])`,
);
rejection(
  "reject_empty_membership",
  `archive.authenticate(archive.empty_root, 0, #"00", [])`,
);
rejection(
  "reject_negative_index",
  `archive.authenticate(${bytes(three.root)}, -1, #"00", [])`,
);
rejection(
  "reject_index_at_count",
  `archive.authenticate(${bytes(three.root)}, 3, #"00", [])`,
);
const witness = three.memberships[0];
rejection(
  "reject_extra_sibling",
  `archive.authenticate(${bytes(three.root)}, 0, ${bytes(witness.value)}, ${
    list([...witness.path, wrong])
  })`,
);
rejection(
  "reject_missing_sibling",
  `archive.authenticate(${bytes(three.root)}, 0, ${bytes(witness.value)}, [])`,
);
rejection(
  "reject_short_sibling",
  `archive.authenticate(${bytes(three.root)}, 0, ${bytes(witness.value)}, ${
    list(["ff", ...witness.path.slice(1)])
  })`,
);
source += `test reject_changed_record() { !archive.authenticate(${
  bytes(three.root)
}, 0, #"ff", ${list(witness.path)}) }\n`;
source += `test reject_wrong_index() { !archive.authenticate(${
  bytes(three.root)
}, 1, ${bytes(witness.value)}, ${list(witness.path)}) }\n`;
source += `test reject_wrong_sibling() { !archive.authenticate(${
  bytes(three.root)
}, 0, ${bytes(witness.value)}, ${list([wrong, ...witness.path.slice(1)])}) }\n`;
await Deno.writeTextFile(Deno.args[0], source);
await Deno.writeTextFile(Deno.args[1], JSON.stringify(vectors));
console.error(`Cross-checked ${vectors.length} sizes through 6,001 leaves`);
