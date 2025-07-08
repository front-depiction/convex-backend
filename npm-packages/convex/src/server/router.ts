import { performJsSyscall } from "./impl/syscall.js";
import { PublicHttpAction } from "./registration.js";
import * as Data from "effect/Data"
import * as Either from "effect/Either"
import * as Option from "effect/Option"
import * as Effect from "effect/Effect"
import { jsonStringify } from "./utils.js";
import { ConvexError } from "../values/errors.js";

class MissingHandler extends Data.TaggedError("MissingHandler")<{
  message: string;
}>{ }
class MissingMethod extends Data.TaggedError("MissingMethod")<{
  message: string;
}>{ }
class InvalidMethod extends Data.TaggedError("InvalidMethod")<{ method: string }>{ }
class BothPathAndPrefix extends Data.TaggedError("BothPathAndPrefix")<{}>{ }
class PathDoesNotStartWithSlash extends Data.TaggedError("PathDoesNotStartWithSlash")<{ path: string }>{ }
class PrefixDoesNotStartWithSlash extends Data.TaggedError("PrefixDoesNotStartWithSlash")<{ prefix: string }>{ }
class PrefixDoesNotEndWithSlash extends Data.TaggedError("PrefixDoesNotEndWithSlash")<{ prefix: string }>{ }
class DuplicateRoute extends Data.TaggedError("DuplicateRoute")<{ path: string; method: string }>{ }
class DuplicatePrefix extends Data.TaggedError("DuplicatePrefix")<{ prefix: string; method: string }>{ }

type HttpRouterError =
  | MissingHandler
  | MissingMethod
  | InvalidMethod
  | BothPathAndPrefix
  | PathDoesNotStartWithSlash
  | PrefixDoesNotStartWithSlash
  | PrefixDoesNotEndWithSlash
  | DuplicateRoute
  | DuplicatePrefix



// Note: this list is duplicated in the dashboard.
/**
 * A list of the methods supported by Convex HTTP actions.
 *
 * HEAD is handled by Convex by running GET and stripping the body.
 * CONNECT is not supported and will not be supported.
 * TRACE is not supported and will not be supported.
 *
 * @public
 */
export const ROUTABLE_HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "OPTIONS",
  "PATCH",
] as const;
/**
 * A type representing the methods supported by Convex HTTP actions.
 *
 * HEAD is handled by Convex by running GET and stripping the body.
 * CONNECT is not supported and will not be supported.
 * TRACE is not supported and will not be supported.
 *
 * @public
 */
export type RoutableMethod = (typeof ROUTABLE_HTTP_METHODS)[number];

export function normalizeMethod(
  method: RoutableMethod | "HEAD",
): RoutableMethod {
  // This router routes HEAD requests as GETs, letting Axum strip thee response
  // bodies are response bodies afterward.
  if (method === "HEAD") return "GET";
  return method;
}

/**
 * Return a new {@link HttpRouter} object.
 *
 * @public
 */
export const httpRouter = () => new HttpRouter();

/**
 * A type representing a route to an HTTP action using an exact request URL path match.
 *
 * Used by {@link HttpRouter} to route requests to HTTP actions.
 *
 * @public
 */
export type RouteSpecWithPath = {
  /**
   * Exact HTTP request path to route.
   */
  path: string;
  /**
   * HTTP method ("GET", "POST", ...) to route.
   */
  method: RoutableMethod;
  /**
   * The HTTP action to execute.
   */
  handler: PublicHttpAction;
};

/**
 * A type representing a route to an HTTP action using a request URL path prefix match.
 *
 * Used by {@link HttpRouter} to route requests to HTTP actions.
 *
 * @public
 */
export type RouteSpecWithPathPrefix = {
  /**
   * An HTTP request path prefix to route. Requests with a path starting with this value
   * will be routed to the HTTP action.
   */
  pathPrefix: string;
  /**
   * HTTP method ("GET", "POST", ...) to route.
   */
  method: RoutableMethod;
  /**
   * The HTTP action to execute.
   */
  handler: PublicHttpAction;
};

/**
 * A type representing a route to an HTTP action.
 *
 * Used by {@link HttpRouter} to route requests to HTTP actions.
 *
 * @public
 */
export type RouteSpec = RouteSpecWithPath | RouteSpecWithPathPrefix;

/**
 * HTTP router for specifying the paths and methods of {@link httpActionGeneric}s
 *
 * An example `convex/http.js` file might look like this.
 *
 * ```js
 * import { httpRouter } from "convex/server";
 * import { getMessagesByAuthor } from "./getMessagesByAuthor";
 * import { httpAction } from "./_generated/server";
 *
 * const http = httpRouter();
 *
 * // HTTP actions can be defined inline...
 * http.route({
 *   path: "/message",
 *   method: "POST",
 *   handler: httpAction(async ({ runMutation }, request) => {
 *     const { author, body } = await request.json();
 *
 *     await runMutation(api.sendMessage.default, { body, author });
 *     return new Response(null, {
 *       status: 200,
 *     });
 *   })
 * });
 *
 * // ...or they can be imported from other files.
 * http.route({
 *   path: "/getMessagesByAuthor",
 *   method: "GET",
 *   handler: getMessagesByAuthor,
 * });
 *
 * // Convex expects the router to be the default export of `convex/http.js`.
 * export default http;
 * ```
 *
 * @public
 */
export class HttpRouter {
  exactRoutes: Map<string, Map<RoutableMethod, PublicHttpAction>> = new Map();
  prefixRoutes: Map<RoutableMethod, Map<string, PublicHttpAction>> = new Map();
  isRouter: true = true;

  /**
   * Specify an HttpAction to be used to respond to requests
   * for an HTTP method (e.g. "GET") and a path or pathPrefix.
   *
   * Paths must begin with a slash. Path prefixes must also end in a slash.
   *
   * ```js
   * // matches `/profile` (but not `/profile/`)
   * http.route({ path: "/profile", method: "GET", handler: getProfile})
   *
   * // matches `/profiles/`, `/profiles/abc`, and `/profiles/a/c/b` (but not `/profile`)
   * http.route({ pathPrefix: "/profile/", method: "GET", handler: getProfile})
   * ```
   */
  route = (spec: RouteSpec): Either.Either<void, HttpRouterError> => Either.gen(this, function* () {
    {
      if (!spec.handler) yield* Either.left(new MissingHandler({ message: `route requires handler` }));
      if (!spec.method) yield* Either.left(new MissingMethod({ message: `route requires method` }));
      const { method, handler } = spec;

      if (!ROUTABLE_HTTP_METHODS.includes(method)) {
        yield* Either.left(new InvalidMethod({ method }));
      }

      if ("path" in spec) {
        if ("pathPrefix" in spec) {
          yield* Either.left(new BothPathAndPrefix());
        }
        if (!spec.path.startsWith("/")) {
          yield* Either.left(new PathDoesNotStartWithSlash({ path: spec.path }));
        }
        const methods: Map<RoutableMethod, PublicHttpAction> =
          this.exactRoutes.has(spec.path)
            ? this.exactRoutes.get(spec.path)!
            : new Map();
        if (methods.has(method)) {
          yield* Either.left(new DuplicateRoute({ path: spec.path, method }));
        }
        methods.set(method, handler);
        this.exactRoutes.set(spec.path, methods);
      } else if ("pathPrefix" in spec) {
        if (!spec.pathPrefix.startsWith("/")) {
          yield* Either.left(new PrefixDoesNotStartWithSlash({ prefix: spec.pathPrefix }));
        }
        if (!spec.pathPrefix.endsWith("/")) {
          yield* Either.left(new PrefixDoesNotEndWithSlash({ prefix: spec.pathPrefix }));
        }
        const prefixes =
          this.prefixRoutes.get(method) || new Map<string, PublicHttpAction>();
        if (prefixes.has(spec.pathPrefix)) {
          yield* Either.left(new DuplicatePrefix({ prefix: spec.pathPrefix, method }));
        }
        prefixes.set(spec.pathPrefix, handler);
        this.prefixRoutes.set(method, prefixes);
      } else {
        yield* Either.left(new BothPathAndPrefix());
      }
    }
  })

  /**
   * Returns a list of routed HTTP actions.
   *
   * These are used to populate the list of routes shown in the Functions page of the Convex dashboard.
   *
   * @returns - an array of [path, method, endpoint] tuples.
   */
  getRoutes = (): Array<
    Readonly<[string, RoutableMethod, PublicHttpAction]>
  > => {
    const exactPaths: string[] = [...this.exactRoutes.keys()].sort();
    const exact = exactPaths.flatMap((path) =>
      [...this.exactRoutes.get(path)!.keys()]
        .sort()
        .map(
          (method) =>
            [path, method, this.exactRoutes.get(path)!.get(method)!] as const,
        ),
    );

    const prefixPathMethods = [...this.prefixRoutes.keys()].sort();
    const prefixes = prefixPathMethods.flatMap((method) =>
      [...this.prefixRoutes.get(method)!.keys()]
        .sort()
        .map(
          (pathPrefix) =>
            [
              `${pathPrefix}*`,
              method,
              this.prefixRoutes.get(method)!.get(pathPrefix)!,
            ] as const,
        ),
    );

    return [...exact, ...prefixes];
  };

  /**
   * Returns the appropriate HTTP action and its routed request path and method.
   *
   * The path and method returned are used for logging and metrics, and should
   * match up with one of the routes returned by `getRoutes`.
   *
   * For example,
   *
   * ```js
   * http.route({ pathPrefix: "/profile/", method: "GET", handler: getProfile});
   *
   * http.lookup("/profile/abc", "GET") // returns [getProfile, "GET", "/profile/*"]
   *```
   *
   * @returns - a tuple [{@link PublicHttpAction}, method, path] or null.
   */
  lookup = (
    path: string,
    method: RoutableMethod | "HEAD",
  ): Option.Option<Readonly<[PublicHttpAction, RoutableMethod, string]>> => {
    method = normalizeMethod(method);
    const exactMatch = this.exactRoutes.get(path)?.get(method);
    if (exactMatch) return Option.some([exactMatch, method, path]);

    const prefixes = this.prefixRoutes.get(method) || new Map();
    const prefixesSorted = [...prefixes.entries()].sort(
      ([prefixA, _a], [prefixB, _b]) => prefixB.length - prefixA.length,
    );
    for (const [pathPrefix, endpoint] of prefixesSorted) {
      if (path.startsWith(pathPrefix)) {
        return Option.some([endpoint, method, `${pathPrefix}*`]);
      }
    }
    return Option.none();
  };

  /**
   * Given a JSON string representation of a Request object, return a Response
   * by routing the request and running the appropriate endpoint or returning
   * a 404 Response.
   *
   * @param argsStr - a JSON string representing a Request object.
   *
   * @returns - a Response object.
   */
  runRequest = (
    argsStr: string,
    requestRoute: string,
  ): Effect.Effect<string, ConvexError<string>, any> => {
    return Effect.gen(this, function* () {
      const request = yield* performJsSyscall("requestFromConvexJson", {
        convexJson: JSON.parse(argsStr),
      });

      let pathname = requestRoute;
      if (!pathname || typeof pathname !== "string") {
        pathname = new URL(request.url).pathname;
      }

      const method = request.method;
      return yield* Option.match(this.lookup(pathname, method as RoutableMethod), {
        onNone: () => {
          const response = new Response(`No HttpAction routed for ${pathname}`, {
            status: 404,
          });
          return performJsSyscall("convexJsonFromResponse", { response });
        },
        onSome: ([endpoint, _method, _path]) => endpoint.invokeHttpAction(request).pipe(
          (response) => performJsSyscall("convexJsonFromResponse", { response }),
          jsonStringify
        )
      })
    }).pipe(
      Effect.catchAll((e) => {
        return new ConvexError({
          data: e._tag === "ConvexError" ? e.data : e.message
        })
      })
    )
  };
}
