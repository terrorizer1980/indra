import { jsonRpcDeserialize, Node } from "@counterfactual/node";
import { Node as NodeTypes } from "@counterfactual/types";
import { utils } from "ethers";
import fetch from "node-fetch";
import { isNullOrUndefined } from "util";

const formatEther = utils.formatEther;

// Capitalizes first char of a string
export const capitalize = (str: string): string =>
  str.substring(0, 1).toUpperCase() + str.substring(1);

export const objMap = <T, F extends keyof T, R>(
  obj: T,
  func: (val: T[F], field: F) => R,
): { [key in keyof T]: R } => {
  const res: any = {};
  for (const key in obj) {
    if ((obj as any).hasOwnProperty(key)) {
      res[key] = func(key as any, obj[key] as any);
    }
  }
  return res;
};

export const objMapPromise = async <T, F extends keyof T, R>(
  obj: T,
  func: (val: T[F], field: F) => Promise<R>,
): Promise<{ [key in keyof T]: R }> => {
  const res: any = {};
  for (const key in obj) {
    if ((obj as any).hasOwnProperty(key)) {
      res[key] = await func(key as any, obj[key] as any);
    }
  }
  return res;
};

export const insertDefault = (val: string, obj: any, keys: string[]): any => {
  const adjusted = {} as any;
  keys.concat(Object.keys(obj)).map((k: any): any => {
    // check by index and undefined
    adjusted[k] = isNullOrUndefined(obj[k])
      ? val // not supplied set as default val
      : obj[k];
  });

  return adjusted;
};

export const delay = (ms: number): Promise<void> =>
  new Promise((res: any): any => setTimeout(res, ms));

// TODO: Temporary - this eventually should be exposed at the top level and retrieve from store
// @rahul: will this eventually be a node api client method or always
// called through the cf node?
export async function getFreeBalance(
  node: Node,
  multisigAddress: string,
): Promise<NodeTypes.GetFreeBalanceStateResult> {
  // @rahul is this the right Rpc params/obj?
  const res = await node.router.dispatch(
    jsonRpcDeserialize({
      id: Date.now(),
      jsonrpc: "2.0",
      method: NodeTypes.MethodName.GET_FREE_BALANCE_STATE,
      params: { multisigAddress },
    }),
  );

  return res as NodeTypes.GetFreeBalanceStateResult;
}

// TODO: Should we keep this? It's a nice helper to break out by key. Maybe generalize?
// ^^^ generalized is the objMap function we have already, we can delete this
// added an example of how to use the obj map thing - layne
export function logEthFreeBalance(freeBalance: NodeTypes.GetFreeBalanceStateResult): void {
  console.info(`Channel's free balance:`);
  const cb = (k: string, v: any): void => {
    console.info(k, formatEther(v));
  };
  objMap(freeBalance, cb);
}

// TODO: Temporary fn which gets multisig address via http.
// This should eventually be derived internally from user/node xpub.
export async function getMultisigAddress(baseURL: string, xpub: string): Promise<string> {
  const bot = await getUser(baseURL, xpub);
  console.log("bot: ", bot);
  const multisigAddress = bot.channels.length > 0 ? bot.channels[0].multisigAddress : undefined;
  if (!multisigAddress) {
    console.info(
      `The Bot doesn't have a channel with the Playground yet... ` +
        `Waiting for another [hardcoded] 2 seconds`,
    );
    // Convert to milliseconds
    await delay(2 * 1000).then(() => getMultisigAddress(baseURL, xpub));
  }
  return (await getUser(baseURL, xpub)).channels[0].multisigAddress;
}

// TODO: Temporary fn which gets user details via http.
export async function getUser(baseURL: string, xpub: string): Promise<any> {
  if (!xpub) {
    throw new Error("getUser(): xpub is required");
  }

  try {
    const userJson = await get(baseURL, `users/${xpub}`);
    return userJson;
  } catch (e) {
    return Promise.reject(e);
  }
}

// TODO: Temporary fn which deploys multisig and returns address/hash
export async function createAccount(baseURL: string, user: { xpub: string }): Promise<object> {
  console.log("Create account activated!");
  try {
    let userRes;
    userRes = await get(baseURL, `users/${user.xpub}`);
    if (!userRes || !(userRes as any).id) {
      userRes = await post(baseURL, "users", user);
    }
    console.log("userRes: ", userRes);

    const multisigRes = await post(baseURL, "channels", {
      counterpartyXpub: user.xpub,
    });
    console.log("multisigRes: ", multisigRes);

    return {
      ...userRes,
      transactionHash: (multisigRes as any).transactionHash,
    };
  } catch (e) {
    return Promise.reject(e);
  }
}

// TODO: ???
function timeout(delay: number = 30000): any {
  const handler = setTimeout(() => {
    throw new Error("Request timed out");
  }, delay);

  return {
    cancel(): any {
      clearTimeout(handler);
    },
  };
}

// TODO: Temporary!!
async function get(baseURL: string, endpoint: string): Promise<object> {
  const requestTimeout = timeout();

  const httpResponse = await fetch(`${baseURL}/${endpoint}`, {
    method: "GET",
  });

  requestTimeout.cancel();

  let response;
  let retriesAvailable = 10;

  while (typeof response === "undefined") {
    try {
      response = await httpResponse.json();
    } catch (e) {
      retriesAvailable -= 1;
      if (e.type === "invalid-json" && retriesAvailable >= 0) {
        console.log(
          `Call to ${baseURL}/api/${endpoint} returned invalid JSON. Retrying (attempt #${10 -
            retriesAvailable}).`,
        );
        await delay(3000);
      } else throw e;
    }
  }

  if (response.errors) {
    const error = response.errors[0];
    throw error;
  }

  return response;
}

// TODO: Temporary!!
async function post(baseURL: string, endpoint: string, data: any): Promise<any> {
  const body = JSON.stringify(data);
  const httpResponse = await fetch(`${baseURL}/${endpoint}`, {
    body,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    method: "POST",
  });

  const response = await httpResponse.json();

  if (response.errors) {
    const error = response.errors[0];
    throw error;
  }

  return response;
}
