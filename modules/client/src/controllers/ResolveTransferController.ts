import {
  ConditionalTransferTypes,
  EventNames,
  HashLockTransferAppAction,
  PublicParams,
  PublicResults,
  getTransferTypeFromAppName,
  GenericConditionalTransferAppState,
  SimpleSignedTransferAppAction,
  SimpleLinkedTransferAppAction,
  GraphSignedTransferAppAction,
  AppInstanceJson,
  HashLockTransferAppState,
} from "@connext/types";
import { stringify, getRandomBytes32, toBN } from "@connext/utils";
import { BigNumber } from "ethers";

import { AbstractController } from "./AbstractController";

export class ResolveTransferController extends AbstractController {
  public resolveTransfer = async (
    params: PublicParams.ResolveCondition,
  ): Promise<PublicResults.ResolveCondition> => {
    const { conditionType, paymentId } = params;
    this.log.info(`[${paymentId}] resolveTransfer started: ${stringify(params)}`);

    // Get app def
    const appDefinition = this.connext.appRegistry.find((app) => app.name === conditionType)
      .appDefinitionAddress;

    // Helper fns
    const findApp = (apps: AppInstanceJson[]) => {
      return apps.find((app) => {
        return (
          app.appDefinition === appDefinition &&
          app.meta.paymentId === paymentId &&
          (app.latestState as GenericConditionalTransferAppState).coinTransfers[1].to ===
            this.connext.signerAddress
        );
      });
    };

    const emitFailureEvent = (error: Error) => {
      this.connext.emit(EventNames.CONDITIONAL_TRANSFER_FAILED_EVENT, {
        error: error.message,
        paymentId,
        type: conditionType,
      });
      return;
    };

    // Extract the secret object from the params;
    if (!this.hasSecret(params)) {
      // User is cancelling the payment
      try {
        console.log(`trying to cancel payment`);
        const ret = await this.handleCancellation(params);
        this.log.info(`[${paymentId}] resolveCondition complete: ${stringify(ret)}`);
        return ret;
      } catch (e) {
        emitFailureEvent(e);
        throw e;
      }
    }

    // Install app with receiver
    let appIdentityHash: string;
    let amount: BigNumber;
    let assetId: string;
    let meta: any;

    // NOTE: there are cases where the app may be installed from the
    // queue, so make sure all values pulled from store are fresh
    let existingReceiverApp = findApp(await this.connext.getAppInstances());
    const existingReceiverAppProposal = findApp(
      (await this.connext.getProposedAppInstances()).appInstances,
    );
    if (existingReceiverApp) {
      appIdentityHash = existingReceiverApp.identityHash;
      this.log.debug(
        `[${paymentId}] Found existing transfer app, proceeding with ${appIdentityHash}: ${JSON.stringify(
          existingReceiverApp.latestState,
        )}`,
      );
      amount = (existingReceiverApp.latestState as GenericConditionalTransferAppState)
        .coinTransfers[0].amount;
      assetId = existingReceiverApp.outcomeInterpreterParameters["tokenAddress"];
      meta = existingReceiverApp.meta;
    } else if (existingReceiverAppProposal) {
      try {
        this.log.debug(
          `[${paymentId}] Found existing transfer proposal, proceeding with install of ${
            existingReceiverAppProposal.identityHash
          } using state: ${JSON.stringify(existingReceiverAppProposal.latestState)}`,
        );
        await this.connext.installApp(existingReceiverAppProposal.identityHash);
        appIdentityHash = existingReceiverAppProposal.identityHash;
        amount = (existingReceiverAppProposal.latestState as GenericConditionalTransferAppState)
          .coinTransfers[0].amount;
        assetId = existingReceiverAppProposal.outcomeInterpreterParameters["tokenAddress"];
        meta = existingReceiverAppProposal.meta;
      } catch (e) {
        emitFailureEvent(e);
        throw e;
      }
    } else {
      try {
        // App is not installed
        const transferType = getTransferTypeFromAppName(conditionType);
        // See note about fresh data
        existingReceiverApp = findApp(await this.connext.getAppInstances());
        if (!existingReceiverApp) {
          if (transferType === "RequireOnline") {
            throw new Error(
              `Receiver app has not been installed, channel: ${stringify(
                await this.connext.getStateChannel(),
              )}`,
            );
          }
          this.log.debug(`[${paymentId}] Requesting node install app`);
          const installRes = await this.connext.node.installConditionalTransferReceiverApp(
            paymentId,
            conditionType,
          );
          appIdentityHash = installRes.appIdentityHash;
          amount = installRes.amount;
          assetId = installRes.assetId;
          meta = installRes.meta;
          if (
            conditionType === ConditionalTransferTypes.LinkedTransfer &&
            installRes.meta.recipient
          ) {
            // TODO: this is hacky
            this.log.error(`Returning early from install, unlock will happen through listener`);
            // @ts-ignore
            return;
          }
        } else {
          // See node about race condition with queue
          appIdentityHash = existingReceiverApp.identityHash;
          this.log.debug(
            `[${paymentId}] Found existing transfer app, proceeding with ${appIdentityHash}: ${JSON.stringify(
              existingReceiverApp.latestState,
            )}`,
          );
          amount = (existingReceiverApp.latestState as GenericConditionalTransferAppState)
            .coinTransfers[0].amount;
          assetId = existingReceiverApp.outcomeInterpreterParameters["tokenAddress"];
          meta = existingReceiverApp.meta;
        }
      } catch (e) {
        emitFailureEvent(e);
        throw e;
      }
    }

    // Ensure all values are properly defined before proceeding
    if (!appIdentityHash || !amount || !assetId || !meta) {
      const message =
        `Failed to install receiver app properly for ${paymentId}, missing one of:\n` +
        `   - appIdentityHash: ${appIdentityHash}\n` +
        `   - amount: ${stringify(amount)}\n` +
        `   - assetId: ${assetId}\n` +
        `   - meta: ${stringify(meta)}`;
      const e = { message };
      emitFailureEvent(e as any);
      throw new Error(message);
    }

    this.log.info(`[${paymentId}] Taking action on receiver app: ${appIdentityHash}`);

    // Take action + uninstall app
    try {
      let action:
        | HashLockTransferAppAction
        | SimpleSignedTransferAppAction
        | GraphSignedTransferAppAction
        | SimpleLinkedTransferAppAction;
      switch (conditionType) {
        case ConditionalTransferTypes.HashLockTransfer: {
          const { preImage } = params as PublicParams.ResolveHashLockTransfer;
          action = preImage && ({ preImage } as HashLockTransferAppAction);
          break;
        }
        case ConditionalTransferTypes.GraphTransfer: {
          const { responseCID, signature } = params as PublicParams.ResolveGraphTransfer;
          action =
            responseCID &&
            signature &&
            ({ responseCID, signature } as GraphSignedTransferAppAction);
          break;
        }
        case ConditionalTransferTypes.SignedTransfer: {
          const { data, signature } = params as PublicParams.ResolveSignedTransfer;
          action = data && signature && ({ data, signature } as SimpleSignedTransferAppAction);
          break;
        }
        case ConditionalTransferTypes.LinkedTransfer: {
          const { preImage } = params as PublicParams.ResolveLinkedTransfer;
          action = preImage && ({ preImage } as SimpleLinkedTransferAppAction);
          break;
        }
        default: {
          const c: never = conditionType;
          this.log.error(`[${paymentId}] Unsupported conditionType ${c}`);
        }
      }
      this.log.info(`[${paymentId}] Uninstalling transfer app with action ${appIdentityHash}`);
      await this.connext.uninstallApp(appIdentityHash, action);
      this.log.info(`[${paymentId}] Finished uninstalling transfer app ${appIdentityHash}`);
    } catch (e) {
      emitFailureEvent(e);
      throw e;
    }
    const sender = meta.sender;

    const result: PublicResults.ResolveCondition = {
      amount,
      appIdentityHash,
      assetId,
      sender,
      meta,
      paymentId,
    };
    this.log.info(`[${paymentId}] resolveCondition complete: ${stringify(result)}`);
    return result;
  };

  // Helper functions
  private hasSecret(params: PublicParams.ResolveCondition): boolean {
    const { conditionType, paymentId } = params;
    switch (conditionType) {
      case ConditionalTransferTypes.HashLockTransfer: {
        const { preImage } = params as PublicParams.ResolveHashLockTransfer;
        return !!preImage;
      }
      case ConditionalTransferTypes.GraphTransfer: {
        const { responseCID, signature } = params as PublicParams.ResolveGraphTransfer;
        return !!responseCID && !!signature;
      }
      case ConditionalTransferTypes.SignedTransfer: {
        const { data, signature } = params as PublicParams.ResolveSignedTransfer;
        return !!data && !!signature;
      }
      case ConditionalTransferTypes.LinkedTransfer: {
        const { preImage } = params as PublicParams.ResolveLinkedTransfer;
        return !!preImage;
      }
      default: {
        const c: never = conditionType;
        this.log.error(`[${paymentId}] Unsupported conditionType ${c}`);
      }
    }
    throw new Error(`Invalid condition type: ${conditionType}`);
  }

  private async handleCancellation(
    params: PublicParams.ResolveCondition,
  ): Promise<PublicResults.ResolveCondition> {
    const { conditionType, paymentId } = params;
    const appDefinition = this.connext.appRegistry.find((app) => app.name === conditionType)
      .appDefinitionAddress;
    const apps = await this.connext.getAppInstances();
    const paymentApp = apps.find((app) => {
      const participants = (app.latestState as GenericConditionalTransferAppState).coinTransfers.map(
        (t) => t.to,
      );
      return (
        app.appDefinition === appDefinition &&
        app.meta.paymentId === paymentId &&
        participants.includes(this.connext.signerAddress)
      );
    });

    if (!paymentApp) {
      throw new Error(`Cannot find payment associated with ${paymentId}`);
    }

    const ret = {
      appIdentityHash: paymentApp.identityHash,
      amount: (paymentApp.latestState as GenericConditionalTransferAppState).coinTransfers[0]
        .amount,
      assetId: paymentApp.outcomeInterpreterParameters["tokenAddress"],
      meta: paymentApp.meta,
      paymentId: params.paymentId,
      sender: paymentApp.meta.sender,
    };

    switch (conditionType) {
      case ConditionalTransferTypes.HashLockTransfer: {
        // if it is the sender app, can only cancel if the app has expired
        const state = paymentApp.latestState as HashLockTransferAppState;
        const isSender = state.coinTransfers[0].to === this.connext.signerAddress;

        if (isSender) {
          // uninstall app
          this.log.info(
            `[${paymentId}] Uninstalling transfer app without action ${paymentApp.identityHash}`,
          );
          await this.connext.uninstallApp(paymentApp.identityHash);
          this.log.info(
            `[${paymentId}] Finished uninstalling transfer app ${paymentApp.identityHash}`,
          );
          return ret;
        }

        let action = undefined;
        if (toBN(await this.ethProvider.getBlockNumber()).lt(toBN(state.expiry))) {
          // uninstall with bad action iff the app is active, otherwise just
          // uninstall
          action = { preImage: getRandomBytes32() };
        }
        this.log.info(
          `[${paymentId}] Uninstalling transfer app with empty action ${paymentApp.identityHash}`,
        );
        console.log(`uninstalling payment with action`, action);
        await this.connext.uninstallApp(paymentApp.identityHash, action);
        this.log.info(
          `[${paymentId}] Finished uninstalling transfer app ${paymentApp.identityHash}`,
        );
        return ret;
      }
      case ConditionalTransferTypes.GraphTransfer:
      case ConditionalTransferTypes.SignedTransfer:
      case ConditionalTransferTypes.LinkedTransfer: {
        // uninstall the app without taking action
        this.log.info(
          `[${paymentId}] Uninstalling transfer app without action ${paymentApp.identityHash}`,
        );
        await this.connext.uninstallApp(paymentApp.identityHash);
        this.log.info(
          `[${paymentId}] Finished uninstalling transfer app ${paymentApp.identityHash}`,
        );
        return ret;
      }
      default: {
        const c: never = conditionType;
        throw new Error(`Unable to cancel payment, unsupported condition ${c}`);
      }
    }
  }
}
