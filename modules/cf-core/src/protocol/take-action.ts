import { ProtocolNames, ProtocolParams, ProtocolRoles, TakeActionMiddlewareContext } from "@connext/types";

import { UNASSIGNED_SEQ_NO } from "../constants";
import { getSetStateCommitment } from "../ethereum";
import {
  Context,
  Opcode,
  PersistAppType,
  ProtocolExecutionFlow,
  ProtocolMessage,
  PersistCommitmentType,
} from "../types";
import { logTime } from "../utils";
import { xkeyKthAddress } from "../xkeys";

import { assertIsValidSignature, stateChannelClassFromStoreByMultisig } from "./utils";

const protocol = ProtocolNames.takeAction;
const {
  OP_SIGN,
  OP_VALIDATE,
  IO_SEND,
  IO_SEND_AND_WAIT,
  PERSIST_APP_INSTANCE,
  PERSIST_COMMITMENT,
} = Opcode;
/**
 * @description This exchange is described at the following URL:
 *
 * TODO: write a todo message here
 *
 */
export const TAKE_ACTION_PROTOCOL: ProtocolExecutionFlow = {
  0 /* Initiating */: async function*(context: Context) {
    const { store, message, network } = context;
    const log = context.log.newContext("CF-TakeActionProtocol");
    const start = Date.now();
    log.debug(`Initiation started for Take Action`);

    const { processID, params } = message;

    const {
      appIdentityHash,
      multisigAddress,
      responderXpub,
      action,
    } = params as ProtocolParams.TakeAction;

    const preProtocolStateChannel = await stateChannelClassFromStoreByMultisig(
      multisigAddress,
      store,
    );
    // 8ms
    const preAppInstance = preProtocolStateChannel.getAppInstance(appIdentityHash);

    yield [
      OP_VALIDATE,
      protocol,
      {
        params,
        appInstance: preAppInstance.toJson(),
        role: ProtocolRoles.initiator,
      } as TakeActionMiddlewareContext,
    ];

    // 40ms
    let substart = Date.now();
    const postProtocolStateChannel = preProtocolStateChannel.setState(
      preAppInstance,
      await preAppInstance.computeStateTransition(action, network.provider),
    );
    logTime(log, substart, `SetState called in takeAction initiating`);

    // 0ms
    const appInstance = postProtocolStateChannel.getAppInstance(appIdentityHash);

    // 0ms
    const responderEphemeralKey = xkeyKthAddress(responderXpub, appInstance.appSeqNo);

    const setStateCommitment = getSetStateCommitment(context, appInstance);
    const setStateCommitmentHash = setStateCommitment.hashToSign();

    // 6ms
    const mySignature = yield [OP_SIGN, setStateCommitmentHash, appInstance.appSeqNo];

    // 117ms
    const {
      customData: { signature: counterpartySig },
    } = yield [
      IO_SEND_AND_WAIT,
      {
        protocol,
        processID,
        params,
        seq: 1,
        toXpub: responderXpub,
        customData: {
          signature: mySignature,
        },
      } as ProtocolMessage,
    ];

    // 10ms
    await assertIsValidSignature(responderEphemeralKey, setStateCommitmentHash, counterpartySig);

    // add signatures and write commitment to store
    const isAppInitiator = appInstance.initiator !== responderEphemeralKey;
    await setStateCommitment.addSignatures(
      isAppInitiator
        ? mySignature as any
        : counterpartySig,
      isAppInitiator
        ? counterpartySig
        : mySignature as any,
    );

    yield [
      PERSIST_COMMITMENT,
      PersistCommitmentType.UpdateSetState,
      setStateCommitment,
      appIdentityHash,
    ];

    yield [
      PERSIST_APP_INSTANCE,
      PersistAppType.UpdateInstance,
      postProtocolStateChannel,
      appInstance,
    ];
    logTime(log, start, `Finished Initiating`);
  },

  1 /* Responding */: async function*(context: Context) {
    const { store, message, network } = context;
    const log = context.log.newContext("CF-TakeActionProtocol");
    const start = Date.now();
    log.debug(`Response started for takeAction`);

    const {
      processID,
      params,
      customData: { signature: counterpartySignature },
    } = message;

    const {
      appIdentityHash,
      multisigAddress,
      initiatorXpub,
      action,
    } = params as ProtocolParams.TakeAction;

    const preProtocolStateChannel = await stateChannelClassFromStoreByMultisig(
      multisigAddress,
      store,
    );

    // 9ms
    const preAppInstance = preProtocolStateChannel.getAppInstance(appIdentityHash);

    yield [
      OP_VALIDATE,
      protocol,
      {
        params,
        appInstance: preAppInstance.toJson(),
        role: ProtocolRoles.responder,
      } as TakeActionMiddlewareContext,
    ];

    // 48ms
    const postProtocolStateChannel = preProtocolStateChannel.setState(
      preAppInstance,
      await preAppInstance.computeStateTransition(action, network.provider),
    );

    // 0ms
    const appInstance = postProtocolStateChannel.getAppInstance(appIdentityHash);

    // 0ms
    const initiatorEphemeralKey = xkeyKthAddress(initiatorXpub, appInstance.appSeqNo);

    const setStateCommitment = getSetStateCommitment(context, appInstance);
    const setStateCommitmentHash = setStateCommitment.hashToSign();

    // 9ms
    await assertIsValidSignature(initiatorEphemeralKey, setStateCommitmentHash, counterpartySignature);

    // 7ms
    const mySignature = yield [OP_SIGN, setStateCommitmentHash, appInstance.appSeqNo];

    // add signatures and write commitment to store
    const isAppInitiator = appInstance.initiator !== initiatorEphemeralKey;
    await setStateCommitment.addSignatures(
      isAppInitiator
        ? mySignature as any
        : counterpartySignature,
      isAppInitiator
        ? counterpartySignature
        : mySignature as any,
    );

    yield [
      PERSIST_COMMITMENT,
      PersistCommitmentType.UpdateSetState,
      setStateCommitment,
      appIdentityHash,
    ];

    yield [
      PERSIST_APP_INSTANCE,
      PersistAppType.UpdateInstance,
      postProtocolStateChannel,
      appInstance,
    ];

    // 0ms
    yield [
      IO_SEND,
      {
        protocol,
        processID,
        toXpub: initiatorXpub,
        seq: UNASSIGNED_SEQ_NO,
        customData: {
          signature: mySignature,
        },
      } as ProtocolMessage,
    ];

    // 149ms
    logTime(log, start, `Finished responding to takeAction`);
  },
};
