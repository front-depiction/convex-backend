import { Value, jsonToConvex } from "../../values/value.js";
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import { UnknownException } from "effect/Cause";
import { ConvexError, JSONError } from "../../values/errors.js";
import { jsonParse } from "../utils.js";



declare const Convex: {
  syscall: (op: string, jsonArgs: string) => Effect.Effect<string, ConvexError<any> | UnknownException>;
  asyncSyscall: (op: string, jsonArgs: string) => Effect.Effect<string, ConvexError<any> | UnknownException>;
  jsSyscall: (op: string, args: Record<string, any>) => Effect.Effect<any, ConvexError<any> | UnknownException>;
};
/**
 * Perform a syscall, taking in a JSON-encodable object as an argument, serializing with
 * JSON.stringify, calling into Rust, and then parsing the response as a JSON-encodable
 * value. If one of your arguments is a Convex value, you must call `convexToJson` on it
 * before passing it to this function, and if the return value has a Convex value, you're
 * also responsible for calling `jsonToConvex`: This layer only deals in JSON.
 */

export function performSyscall(op: string, arg: Record<string, any>): Effect.Effect<any, ConvexError<string> | JSONError> {
  return Effect.gen(function* () {
    if (typeof Convex === "undefined" || Convex.syscall === undefined) {
      return yield* new ConvexError({
        data: "The Convex database and auth objects are being used outside of a Convex backend. " +
          "Did you mean to use `useQuery` or `useMutation` to call a Convex function?"
      })
    }
    const resultStr = yield* Convex.syscall(op, JSON.stringify(arg)).pipe(
      Effect.catchTag("UnknownException", (e) => {
        return new ConvexError({
          data: "An unknown error occurred while performing a syscall" + String(e)
        })
      })
    )
    return yield* jsonParse(resultStr)
  })

}

export function performAsyncSyscall(
  op: string,
  arg: Record<string, any>,
): Effect.Effect<any, ConvexError<string | Value> | JSONError> {
  return Effect.gen(function* () {
    if (typeof Convex === "undefined" || Convex.asyncSyscall === undefined) {
      return yield* new ConvexError({
        data: "The Convex database and auth objects are being used outside of a Convex backend. " +
          "Did you mean to use `useQuery` or `useMutation` to call a Convex function?",
      })
    }
    let resultStr = yield* Convex.asyncSyscall(op, JSON.stringify(arg)).pipe(
      Effect.catchTags({
        ConvexError: (e) => {
          return jsonToConvex(e.data).pipe(
            Either.mapBoth({
              onLeft: (e) => new ConvexError({
                data: e.message
              }),
              onRight: (value) => new ConvexError({
                data: value
              })
            }),
            Either.flatMap(Either.left)
          )
        },
        UnknownException: (e) => {
          return new ConvexError({
            data: "An unknown error occurred while performing an async syscall" + String(e)
          })
        }
      })
    )
    return yield* jsonParse(resultStr)
  })

}

/**
 * Call into a "JS" syscall. Like `performSyscall`, this calls a dynamically linked
 * function set up in the Convex function execution. Unlike `performSyscall`, the
 * arguments do not need to be JSON-encodable and neither does the return value.
 *
 * @param op
 * @param arg
 * @returns
 */
export function performJsSyscall(op: string, arg: Record<string, any>): Effect.Effect<any, ConvexError<string>> {
  return Effect.gen(function* () {
    if (typeof Convex === "undefined" || Convex.jsSyscall === undefined) {
      return yield* new ConvexError({
        data: "The Convex database and auth objects are being used outside of a Convex backend. " +
          "Did you mean to use `useQuery` or `useMutation` to call a Convex function?",
      })
    }
    return yield* Convex.jsSyscall(op, arg).pipe(
      Effect.catchTag("UnknownException", (e) => {
        return new ConvexError({
          data: "An unknown error occurred while performing a js syscall" + String(e)
        })
      })
    )
  })
}
