import * as Either from "effect/Either"
import { JSONError } from "../values/errors.js";



export function jsonParse(str: string): Either.Either<any, JSONError> {
    return Either.try({
        try: () => JSON.parse(str),
        catch: (error) => new JSONError({ message: String(error) }),
    });
}

export function jsonStringify(value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): Either.Either<string, JSONError> {
    return Either.try({
        try: () => JSON.stringify(value, replacer, space),
        catch: (error) => new JSONError({ message: String(error) }),
    });
}