// Recursive JSON types — defined via interface to avoid circular type alias errors.
export type JsonPrimitive = string | number | boolean | null;

// Declared as an interface to break the circular type alias restriction.
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface JsonArray extends Array<JsonValue> {}

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
