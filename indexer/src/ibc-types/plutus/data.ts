import {toHex} from '@harmoniclabs/uint8array-utils';
import {Static as _Static, TLiteral, TLiteralValue, TProperties, TSchema, Type} from '@sinclair/typebox';
import {PlutusData} from '@dcspark/cardano-multiplatform-multiera-lib-nodejs';
import {fromHex} from '../../utils/hex';

export class Constr<T> {
  index: number;
  fields: T[];

  constructor(index: number, fields: T[]) {
    this.index = index;
    this.fields = fields;
  }
}

export declare namespace Data {
  export type Static<T extends TSchema, P extends unknown[] = []> = _Static<T, P>;
}

export type Data =
  | bigint // Integer
  | string // Bytes in hex
  | Array<Data>
  | Map<Data, Data> // AssocList
  | Constr<Data>;

export const Data = {
  // Types
  // Note: Recursive types are not supported (yet)
  Integer: function (options?: {
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    exclusiveMaximum?: number;
  }) {
    const integer = Type.Unsafe<bigint>({dataType: 'integer'});
    if (options) {
      Object.entries(options).forEach(([key, value]) => {
        integer[key] = value;
      });
    }
    return integer;
  },
  Bytes: function (options?: {minLength?: number; maxLength?: number; enum?: string[]}) {
    const bytes = Type.Unsafe<string>({dataType: 'bytes'});
    if (options) {
      Object.entries(options).forEach(([key, value]) => {
        bytes[key] = value;
      });
    }
    return bytes;
  },
  Boolean: function () {
    return Type.Unsafe<boolean>({
      anyOf: [
        {
          title: 'False',
          dataType: 'constructor',
          index: 0,
          fields: [],
        },
        {
          title: 'True',
          dataType: 'constructor',
          index: 1,
          fields: [],
        },
      ],
    });
  },
  Any: function () {
    return Type.Unsafe<Data>({description: 'Any Data.'});
  },
  Array: function <T extends TSchema>(
    items: T,
    options?: {minItems?: number; maxItems?: number; uniqueItems?: boolean}
  ) {
    const array = Type.Array(items);
    replaceProperties(array, {dataType: 'list', items});
    if (options) {
      Object.entries(options).forEach(([key, value]) => {
        array[key] = value;
      });
    }
    return array;
  },
  Map: function <T extends TSchema, U extends TSchema>(
    keys: T,
    values: U,
    options?: {minItems?: number; maxItems?: number}
  ) {
    const map = Type.Unsafe<Map<Data.Static<T>, Data.Static<U>>>({
      dataType: 'map',
      keys,
      values,
    });
    if (options) {
      Object.entries(options).forEach(([key, value]) => {
        map[key] = value;
      });
    }
    return map;
  },
  /**
   * Object applies by default a PlutusData Constr with index 0.\
   * Set 'hasConstr' to false to serialize Object as PlutusData List.
   */
  Object: function <T extends TProperties>(properties: T, options?: {hasConstr?: boolean}) {
    const object = Type.Object(properties);
    replaceProperties(object, {
      anyOf: [
        {
          dataType: 'constructor',
          index: 0, // Will be replaced when using Data.Enum
          fields: Object.entries(properties).map(([title, p]) => ({
            ...p,
            title,
          })),
        },
      ],
    });
    object.anyOf[0].hasConstr = typeof options?.hasConstr === 'undefined' || options.hasConstr;
    return object;
  },
  Enum: function <T extends TSchema>(items: T[]) {
    const union = Type.Union(items);
    replaceProperties(union, {
      anyOf: items.map((item, index) =>
        item.anyOf[0].fields.length === 0
          ? {
              ...item.anyOf[0],
              index,
            }
          : {
              dataType: 'constructor',
              title: (() => {
                const title = item.anyOf[0].fields[0].title;
                if ((title as string).charAt(0) !== (title as string).charAt(0).toUpperCase()) {
                  throw new Error(`Enum '${title}' needs to start with an uppercase letter.`);
                }
                return item.anyOf[0].fields[0].title;
              })(),
              index,
              fields: item.anyOf[0].fields[0].items || item.anyOf[0].fields[0].anyOf[0].fields,
            }
      ),
    });
    return union;
  },
  /**
   * Tuple is by default a PlutusData List.\
   * Set 'hasConstr' to true to apply a PlutusData Constr with index 0.
   */
  Tuple: function <T extends TSchema[]>(items: [...T], options?: {hasConstr?: boolean}) {
    const tuple = Type.Tuple(items);
    replaceProperties(tuple, {
      dataType: 'list',
      items,
    });
    if (options) {
      Object.entries(options).forEach(([key, value]) => {
        tuple[key] = value;
      });
    }
    return tuple;
  },
  Literal: function <T extends TLiteralValue>(title: T): TLiteral<T> {
    if ((title as string).charAt(0) !== (title as string).charAt(0).toUpperCase()) {
      throw new Error(`Enum '${title}' needs to start with an uppercase letter.`);
    }
    const literal = Type.Literal(title);
    replaceProperties(literal, {
      anyOf: [
        {
          dataType: 'constructor',
          title,
          index: 0, // Will be replaced in Data.Enum
          fields: [],
        },
      ],
    });
    return literal;
  },
  Nullable: function <T extends TSchema>(item: T) {
    return Type.Unsafe<Data.Static<T> | null>({
      anyOf: [
        {
          title: 'Some',
          description: 'An optional value.',
          dataType: 'constructor',
          index: 0,
          fields: [item],
        },
        {
          title: 'None',
          description: 'Nothing.',
          dataType: 'constructor',
          index: 1,
          fields: [],
        },
      ],
    });
  },

  // /**
  //  * Convert PlutusData to Cbor encoded data.\
  //  * Or apply a shape and convert the provided data struct to Cbor encoded data.
  //  */
  // to,
  // /** Convert Cbor encoded data to PlutusData */
  // from,
  /**
   * Note Constr cannot be used here.\
   * Strings prefixed with '0x' are not UTF-8 encoded.
   */
  // fromJson,
  /**
   * Note Constr cannot be used here, also only bytes/integers as Json keys.\
   */
  // toJson,
  void: function (): Datum | Redeemer {
    return 'd87980';
  },
  // castFrom,
  // castTo,
};

/**
 *  Convert Cbor encoded data to Data.\
 *  Or apply a shape and cast the cbor encoded data to a certain type.
 */
// function from<T = Data>(raw: Datum | Redeemer, type?: T): T {
//   function deserialize(data: PlutusData): Data {
//     if (data.kind() === 0) {
//       const constr = data.as_constr_plutus_data()!;
//       const l = constr.fields();
//       const desL = [];
//       for (let i = 0; i < l.len(); i++) {
//         desL.push(deserialize(l.get(i)));
//       }
//       return new Constr(parseInt(constr.alternative().toString()), desL);
//     } else if (data.kind() === 1) {
//       const m = data.as_map()!;
//       const desM: Map<Data, Data> = new Map();
//       const keys = m.keys();
//       for (let i = 0; i < keys.len(); i++) {
//         desM.set(deserialize(keys.get(i)), deserialize(m.get(keys.get(i))!));
//       }
//       return desM;
//     } else if (data.kind() === 2) {
//       const l = data.as_list()!;
//       const desL = [];
//       for (let i = 0; i < l.len(); i++) {
//         desL.push(deserialize(l.get(i)));
//       }
//       return desL;
//     } else if (data.kind() === 3) {
//       return BigInt(data.as_integer()!.to_str());
//     } else if (data.kind() === 4) {
//       return toHex(data.as_bytes()!);
//     }
//     throw new Error('Unsupported type');
//   }
//   const data = deserialize(PlutusData.from_cbor_bytes(fromHex(raw)));

//   return type ? castFrom<T>(data, type) : (data as T);
// }

// function castFrom<T = Data>(data: Data, type: T): T {
//   const shape = type as Json;
//   if (!shape) throw new Error('Could not type cast data.');
//   const shapeType = (shape.anyOf ? 'enum' : '') || shape.dataType;

//   switch (shapeType) {
//     case 'integer': {
//       if (typeof data !== 'bigint') {
//         throw new Error('Could not type cast to integer.');
//       }
//       integerConstraints(data, shape);
//       return data as T;
//     }
//     case 'bytes': {
//       if (typeof data !== 'string') {
//         throw new Error('Could not type cast to bytes.');
//       }
//       bytesConstraints(data, shape);
//       return data as T;
//     }
//     case 'constructor': {
//       if (isVoid(shape)) {
//         if (!(data instanceof Constr) || data.index !== 0 || data.fields.length !== 0) {
//           throw new Error('Could not type cast to void.');
//         }
//         return undefined as T;
//       } else if (
//         data instanceof Constr &&
//         data.index === shape.index &&
//         (shape.hasConstr || shape.hasConstr === undefined)
//       ) {
//         const fields: Record<string, T> = {};
//         if (shape.fields.length !== data.fields.length) {
//           throw new Error('Could not type cast to object. Fields do not match.');
//         }
//         shape.fields.forEach((field: Json, fieldIndex: number) => {
//           const title = field.title || 'wrapper';
//           if (/[A-Z]/.test(title[0])) {
//             throw new Error('Could not type cast to object. Object properties need to start with a lowercase letter.');
//           }
//           fields[title] = castFrom<T>(data.fields[fieldIndex], field);
//         });
//         return fields as T;
//       } else if (data instanceof Array && !shape.hasConstr && shape.hasConstr !== undefined) {
//         const fields: Record<string, T> = {};
//         if (shape.fields.length !== data.length) {
//           throw new Error('Could not ype cast to object. Fields do not match.');
//         }
//         shape.fields.forEach((field: Json, fieldIndex: number) => {
//           const title = field.title || 'wrapper';
//           if (/[A-Z]/.test(title[0])) {
//             throw new Error('Could not type cast to object. Object properties need to start with a lowercase letter.');
//           }
//           fields[title] = castFrom<T>(data[fieldIndex], field);
//         });
//         return fields as T;
//       }
//       throw new Error('Could not type cast to object.');
//     }
//     case 'enum': {
//       // When enum has only one entry it's a single constructor/record object
//       if (shape.anyOf.length === 1) {
//         return castFrom<T>(data, shape.anyOf[0]);
//       }

//       if (!(data instanceof Constr)) {
//         throw new Error('Could not type cast to enum.');
//       }

//       const enumShape = shape.anyOf.find((entry: Json) => entry.index === data.index);
//       if (!enumShape || enumShape.fields.length !== data.fields.length) {
//         throw new Error('Could not type cast to enum.');
//       }
//       if (isBoolean(shape)) {
//         if (data.fields.length !== 0) {
//           throw new Error('Could not type cast to boolean.');
//         }
//         switch (data.index) {
//           case 0:
//             return false as T;
//           case 1:
//             return true as T;
//         }
//         throw new Error('Could not type cast to boolean.');
//       } else if (isNullable(shape)) {
//         switch (data.index) {
//           case 0: {
//             if (data.fields.length !== 1) {
//               throw new Error('Could not type cast to nullable object.');
//             }
//             return castFrom<T>(data.fields[0], shape.anyOf[0].fields[0]);
//           }
//           case 1: {
//             if (data.fields.length !== 0) {
//               throw new Error('Could not type cast to nullable object.');
//             }
//             return null as T;
//           }
//         }
//         throw new Error('Could not type cast to nullable object.');
//       }
//       switch (enumShape.dataType) {
//         case 'constructor': {
//           if (enumShape.fields.length === 0) {
//             if (/[A-Z]/.test(enumShape.title[0])) {
//               return enumShape.title as T;
//             }
//             throw new Error('Could not type cast to enum.');
//           } else {
//             if (!/[A-Z]/.test(enumShape.title)) {
//               throw new Error('Could not type cast to enum. Enums need to start with an uppercase letter.');
//             }

//             if (enumShape.fields.length !== data.fields.length) {
//               throw new Error('Could not type cast to enum.');
//             }

//             // check if named args
//             const args = enumShape.fields[0].title
//               ? Object.fromEntries(
//                   enumShape.fields.map((field: Json, index: number) => [
//                     field.title,
//                     castFrom<T>(data.fields[index], field),
//                   ])
//                 )
//               : enumShape.fields.map((field: Json, index: number) => castFrom<T>(data.fields[index], field));

//             return {
//               [enumShape.title]: args,
//             } as T;
//           }
//         }
//       }
//       throw new Error('Could not type cast to enum.');
//     }
//     case 'list': {
//       if (shape.items instanceof Array) {
//         // tuple
//         if (data instanceof Constr && data.index === 0 && shape.hasConstr) {
//           return data.fields.map((field, index) => castFrom<T>(field, shape.items[index])) as T;
//         } else if (data instanceof Array && !shape.hasConstr) {
//           return data.map((field, index) => castFrom<T>(field, shape.items[index])) as T;
//         }

//         throw new Error('Could not type cast to tuple.');
//       } else {
//         // array
//         if (!(data instanceof Array)) {
//           throw new Error('Could not type cast to array.');
//         }
//         listConstraints(data, shape);

//         return data.map((field) => castFrom<T>(field, shape.items)) as T;
//       }
//     }
//     case 'map': {
//       if (!(data instanceof Map)) {
//         throw new Error('Could not type cast to map.');
//       }
//       mapConstraints(data, shape);
//       const map = new Map();
//       for (const [key, value] of data.entries()) {
//         map.set(castFrom<T>(key, shape.keys), castFrom<T>(value, shape.values));
//       }
//       return map as T;
//     }
//     case undefined: {
//       return data as T;
//     }
//   }
//   throw new Error('Could not type cast data.');
// }

// function integerConstraints(integer: bigint, shape: TSchema) {
//   if (shape.minimum && integer < BigInt(shape.minimum)) {
//     throw new Error(`Integer ${integer} is below the minimum ${shape.minimum}.`);
//   }
//   if (shape.maximum && integer > BigInt(shape.maximum)) {
//     throw new Error(`Integer ${integer} is above the maxiumum ${shape.maximum}.`);
//   }
//   if (shape.exclusiveMinimum && integer <= BigInt(shape.exclusiveMinimum)) {
//     throw new Error(`Integer ${integer} is below the exclusive minimum ${shape.exclusiveMinimum}.`);
//   }
//   if (shape.exclusiveMaximum && integer >= BigInt(shape.exclusiveMaximum)) {
//     throw new Error(`Integer ${integer} is above the exclusive maximum ${shape.exclusiveMaximum}.`);
//   }
// }

// function bytesConstraints(bytes: string, shape: TSchema) {
//   if (shape.enum && !shape.enum.some((keyword: string) => keyword === bytes))
//     throw new Error(`None of the keywords match with '${bytes}'.`);
//   if (shape.minLength && bytes.length / 2 < shape.minLength) {
//     throw new Error(`Bytes need to have a length of at least ${shape.minLength} bytes.`);
//   }

//   if (shape.maxLength && bytes.length / 2 > shape.maxLength) {
//     throw new Error(`Bytes can have a length of at most ${shape.minLength} bytes.`);
//   }
// }

// function listConstraints(list: Array<unknown>, shape: TSchema) {
//   if (shape.minItems && list.length < shape.minItems) {
//     throw new Error(`Array needs to contain at least ${shape.minItems} items.`);
//   }
//   if (shape.maxItems && list.length > shape.maxItems) {
//     throw new Error(`Array can contain at most ${shape.maxItems} items.`);
//   }
//   if (shape.uniqueItems && new Set(list).size !== list.length) {
//     // Note this only works for primitive types like string and bigint.
//     throw new Error('Array constains duplicates.');
//   }
// }

// function mapConstraints(map: Map<unknown, unknown>, shape: TSchema) {
//   if (shape.minItems && map.size < shape.minItems) {
//     throw new Error(`Map needs to contain at least ${shape.minItems} items.`);
//   }

//   if (shape.maxItems && map.size > shape.maxItems) {
//     throw new Error(`Map can contain at most ${shape.maxItems} items.`);
//   }
// }

// function isBoolean(shape: TSchema): boolean {
//   return shape.anyOf && shape.anyOf[0]?.title === 'False' && shape.anyOf[1]?.title === 'True';
// }

// function isVoid(shape: TSchema): boolean {
//   return shape.index === 0 && shape.fields.length === 0;
// }

// function isNullable(shape: TSchema): boolean {
//   return shape.anyOf && shape.anyOf[0]?.title === 'Some' && shape.anyOf[1]?.title === 'None';
// }

function replaceProperties(object: Json, properties: Json) {
  Object.keys(object).forEach((key) => {
    delete object[key];
  });
  Object.assign(object, properties);
}

/** JSON object */
// deno-lint-ignore no-explicit-any
export type Json = any;

/** Hex (Redeemer is only PlutusData, same as Datum) */
export type Redeemer = string; // Plutus Data (same as Datum)

/** Hex */
export type Datum = string;
