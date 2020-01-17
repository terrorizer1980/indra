import { ConnextStore, FileStorage, MemoryStorage } from "@connext/store";
import { IAsyncStorage, StoreFactoryOptions, StorePair } from "@connext/types";
import fs from "fs";
import localStorage from "localStorage";
import MockAsyncStorage from "mock-async-storage";
import uuid from "uuid";

import { expect } from "../";

const TEST_STORE_PAIR: StorePair = { path: "testing", value: "something" };

export function createStore(
  type: string,
  opts?: StoreFactoryOptions,
  storageOpts?: any,
): { store: ConnextStore; storage: Storage | IAsyncStorage } {
  let storage;

  switch (type.toLowerCase()) {
    case "localstorage":
      storage = localStorage;
      break;

    case "localstorage":
      storage = new MockAsyncStorage(storageOpts);
      break;

    case "filestorage":
      storage = new FileStorage(storageOpts);
      break;

    case "localstorage":
      storage = new MemoryStorage(storageOpts);
      break;

    default:
      throw new Error(`Unable to create test store of type: ${type}`);
  }

  const store = new ConnextStore(storage, opts);
  expect(store).to.be.instanceOf(ConnextStore);

  return { store, storage };
}

export function generateStorePairs(length: number = 10): StorePair[] {
  const id = uuid.v1();
  return Array(length).map(
    (): StorePair => ({
      path: id,
      value: id,
    }),
  );
}

export async function setAndGet(
  store: ConnextStore,
  storePair: StorePair = TEST_STORE_PAIR,
): Promise<void> {
  await store.set([storePair]);
  const value = await store.get(storePair.path);

  expect(value).to.be.equal(storePair.value);
}

export async function setAndGetMultiple(store: ConnextStore, length: number = 10): Promise<void> {
  const pairs = generateStorePairs(length);
  await store.set(pairs);
}

export function testAsyncStorageKey(storage: any, asyncStorageKey: string) {
  const keys = storage.getAllKeys();
  expect(keys.length).to.equal(1);
  expect(keys[0]).to.equal(asyncStorageKey);
}

export function readDir(path: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    fs.readdir(path, (err, files) => {
      if (err) {
        reject(err);
      }
      resolve(files);
    });
  });
}
