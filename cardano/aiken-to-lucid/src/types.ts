export type PlutusDefinition = {
  [T: string]:
    & { path: string }
    & (
      | {
        title: "Data";
        description: "Any Plutus data.";
      }
      | {
        dataType: string;
      }
      | {
        title: string;
        description?: string;
      }
      | {
        dataType: "list";
        items: {
          $ref: string;
        };
      }
      | {
        title: "Dict";
        description?: string;
        dataType: "map";
        keys: {
          $ref: string;
        };
        values: {
          $ref: string;
        };
      }
      | {
        title: string;
        description?: string;
        anyOf: {
          title: string;
          dataType: "constructor";
          index: number;
          fields: {
            title: string;
            $ref: string;
          }[];
        }[];
      }
      | {
        title: string;
        description?: string;
        anyOf: {
          title: string;
          dataType: "constructor";
          index: number;
          fields: {
            $ref: string;
          }[];
        }[];
      }
    );
};

export type AikenType = PlutusDefinition[keyof PlutusDefinition];

export type ImportContent = {
  content: string;
  path: string;
};

// Map from
export type ImportMap = Map<string, ImportContent>;

export type GenType = {
  type: "custom";
  path: string;
  imports: ImportMap;
  name: string;
  schema: string[];
} | {
  type: "primitive";
  schema: string[];
} | {
  type: "composite";
  dependencies: ImportMap;
  schema: string[];
};
