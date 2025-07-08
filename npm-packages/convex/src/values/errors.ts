import { Value } from "./value.js";
import * as Data from "effect/Data"



export class ConvexError<TData extends Value> extends Data.TaggedError("ConvexError")<{
  data: TData;
}> { }

export class JSONError extends Data.TaggedError("JSONError")<{
  message: string;
}> { }