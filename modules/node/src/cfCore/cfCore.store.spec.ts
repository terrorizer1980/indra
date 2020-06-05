import { AppInstanceJson } from "@connext/types";
import {
  getRandomAddress,
  getRandomIdentifier,
  toBN,
  toBNJson,
} from "@connext/utils";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { getConnection } from "typeorm";

import { AppInstanceRepository } from "../appInstance/appInstance.repository";
import { AppRegistryRepository } from "../appRegistry/appRegistry.repository";
import { ChannelRepository } from "../channel/channel.repository";
import { SetStateCommitmentRepository } from "../setStateCommitment/setStateCommitment.repository";
import { WithdrawCommitmentRepository } from "../withdrawCommitment/withdrawCommitment.repository";
import { SetupCommitmentRepository } from "../setupCommitment/setupCommitment.repository";
import { ConditionalTransactionCommitmentRepository } from "../conditionalCommitment/conditionalCommitment.repository";
import { ConfigModule } from "../config/config.module";
import { DatabaseModule } from "../database/database.module";
import { LoggerModule } from "../logger/logger.module";
import {
  createAppInstanceJson,
  createChallengeUpdatedEventPayload,
  createConditionalTransactionCommitmentJSON,
  createMinimalTransaction,
  createSetStateCommitmentJSON,
  createStateChannelJSON,
  createStateProgressedEventPayload,
  createStoredAppChallenge,
  expect,
} from "../test/utils";
import { ConfigService } from "../config/config.service";

import { CFCoreRecordRepository } from "./cfCore.repository";
import { CFCoreStore } from "./cfCore.store";
import { ChallengeRepository, ProcessedBlockRepository } from "../challenge/challenge.repository";

const createTestStateChannelJSONs = (
  nodeIdentifier: string,
  userIdentifier: string = getRandomIdentifier(),
  multisigAddress: string = getRandomAddress(),
) => {
  const channelJson = createStateChannelJSON({
    multisigAddress,
    userIdentifiers: [nodeIdentifier, userIdentifier],
  });
  const setupCommitment = createMinimalTransaction();
  const freeBalanceUpdate = createSetStateCommitmentJSON({
    appIdentityHash: channelJson.freeBalanceAppInstance.identityHash,
  });
  return { channelJson, setupCommitment, freeBalanceUpdate };
};

const createTestChannel = async (
  cfCoreStore: CFCoreStore,
  nodeIdentifier: string,
  userIdentifier: string = getRandomIdentifier(),
  multisigAddress: string = getRandomAddress(),
) => {
  const { channelJson, setupCommitment, freeBalanceUpdate } = createTestStateChannelJSONs(
    nodeIdentifier,
    userIdentifier,
    multisigAddress,
  );
  await cfCoreStore.createStateChannel(channelJson, setupCommitment, freeBalanceUpdate);

  return { multisigAddress, userIdentifier, channelJson, setupCommitment, freeBalanceUpdate };
};

const createTestChannelWithAppInstance = async (
  cfCoreStore: CFCoreStore,
  nodeIdentifier: string,
  userIdentifier: string = getRandomIdentifier(),
  multisigAddress: string = getRandomAddress(),
) => {
  const { channelJson } = await createTestChannel(
    cfCoreStore,
    nodeIdentifier,
    userIdentifier,
    multisigAddress,
  );

  const setStateCommitment = createSetStateCommitmentJSON();
  const appProposal = createAppInstanceJson({
    appSeqNo: 2,
    initiatorIdentifier: userIdentifier,
    responderIdentifier: nodeIdentifier,
  });
  await cfCoreStore.createAppProposal(multisigAddress, appProposal, 2, setStateCommitment);

  const appInstance = createAppInstanceJson({
    identityHash: appProposal.identityHash,
    multisigAddress,
    initiatorIdentifier: userIdentifier,
    responderIdentifier: nodeIdentifier,
    appSeqNo: appProposal.appSeqNo,
  });
  const updatedFreeBalance: AppInstanceJson = {
    ...channelJson.freeBalanceAppInstance!,
    latestState: { appState: "updated" },
  };
  const freeBalanceUpdateCommitment = createSetStateCommitmentJSON({
    appIdentityHash: channelJson.freeBalanceAppInstance.identityHash,
    versionNumber: toBNJson(100),
  });
  const conditionalCommitment = createConditionalTransactionCommitmentJSON({
    appIdentityHash: appInstance.identityHash,
  });
  await cfCoreStore.createAppInstance(
    multisigAddress,
    appInstance,
    updatedFreeBalance,
    freeBalanceUpdateCommitment,
    conditionalCommitment,
  );

  return {
    multisigAddress,
    userIdentifier,
    channelJson,
    appInstance,
    updatedFreeBalance,
    conditionalCommitment,
    freeBalanceUpdateCommitment,
  };
};

const createTestChallengeWithAppInstanceAndChannel = async (
  cfCoreStore: CFCoreStore,
  nodeIdentifier: string,
  userIdentifierParam: string = getRandomAddress(),
  multisigAddressParam: string = getRandomAddress(),
) => {
  const {
    multisigAddress,
    userIdentifier,
    channelJson,
    appInstance,
    updatedFreeBalance,
  } = await createTestChannelWithAppInstance(
    cfCoreStore,
    nodeIdentifier,
    userIdentifierParam,
    multisigAddressParam,
  );

  // add challenge
  const challenge = createStoredAppChallenge({
    identityHash: appInstance.identityHash,
  });
  await cfCoreStore.saveAppChallenge(challenge);

  return {
    challenge,
    multisigAddress,
    userIdentifier,
    channelJson,
    appInstance,
    updatedFreeBalance,
  };
};

describe("CFCoreStore", () => {
  let cfCoreStore: CFCoreStore;
  let configService: ConfigService;
  let channelRepository: ChannelRepository;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CFCoreStore],
      imports: [
        ConfigModule,
        DatabaseModule,
        LoggerModule,
        TypeOrmModule.forFeature([
          CFCoreRecordRepository,
          AppRegistryRepository,
          ChannelRepository,
          AppInstanceRepository,
          ConditionalTransactionCommitmentRepository,
          SetStateCommitmentRepository,
          WithdrawCommitmentRepository,
          SetupCommitmentRepository,
          ChallengeRepository,
          ProcessedBlockRepository,
        ]),
      ],
    }).compile();

    cfCoreStore = moduleRef.get<CFCoreStore>(CFCoreStore);
    configService = moduleRef.get<ConfigService>(ConfigService);
    channelRepository = moduleRef.get<ChannelRepository>(ChannelRepository);
  });

  afterEach(async () => {
    await getConnection().dropDatabase();
    await getConnection().close();
  });

  describe("Channel", () => {
    it("createStateChannel + getStateChannel + getSetupCommitment + getSetStateCommitment", async () => {
      const nodeIdentifier = configService.getPublicIdentifier();
      const { channelJson, setupCommitment, freeBalanceUpdate } = createTestStateChannelJSONs(
        nodeIdentifier,
      );

      for (let index = 0; index < 3; index++) {
        await cfCoreStore.createStateChannel(channelJson, setupCommitment, freeBalanceUpdate);
        const channelFromStore = await cfCoreStore.getStateChannel(channelJson.multisigAddress);
        const userIdentifier = channelJson.userIdentifiers.find((x) => x !== nodeIdentifier);
        expect(channelFromStore).to.deep.equal({
          ...channelJson,
          userIdentifiers: [nodeIdentifier, userIdentifier],
          freeBalanceAppInstance: {
            ...channelJson.freeBalanceAppInstance,
            initiatorIdentifier: nodeIdentifier,
            responderIdentifier: userIdentifier,
          },
        });

        const setupCommitmentFromStore = await cfCoreStore.getSetupCommitment(
          channelJson.multisigAddress,
        );
        expect(setupCommitmentFromStore).to.deep.equal(setupCommitment);

        const freeBalanceUpdateFromStore = await cfCoreStore.getSetStateCommitment(
          channelJson.freeBalanceAppInstance.identityHash,
        );
        expect(freeBalanceUpdateFromStore).to.deep.equal(freeBalanceUpdate);
      }
    });
  });

  describe("App Proposal", () => {
    it("createAppInstanceJson", async () => {
      const { multisigAddress } = await createTestChannel(
        cfCoreStore,
        configService.getPublicIdentifier(),
      );

      const appProposal = createAppInstanceJson({ appSeqNo: 2 });
      const setStateCommitment = createSetStateCommitmentJSON({
        appIdentityHash: appProposal.identityHash,
      });

      for (let index = 0; index < 3; index++) {
        await cfCoreStore.createAppProposal(multisigAddress, appProposal, 2, setStateCommitment);

        const received = await cfCoreStore.getAppProposal(appProposal.identityHash);
        expect(received).to.deep.equal(appProposal);

        const channel = await cfCoreStore.getStateChannel(multisigAddress);
        expect(channel.proposedAppInstances.length).to.equal(1);
        const proposedMap = new Map(channel.proposedAppInstances);
        expect(proposedMap.has(appProposal.identityHash)).to.be.true;
        expect(proposedMap.get(appProposal.identityHash)).to.deep.equal(appProposal);

        const setStateCommitmentFromStore = await cfCoreStore.getSetStateCommitment(
          appProposal.identityHash,
        );
        expect(setStateCommitmentFromStore).to.deep.equal(setStateCommitment);
      }
    });

    it("removeAppProposal", async () => {
      const { multisigAddress } = await createTestChannel(
        cfCoreStore,
        configService.getPublicIdentifier(),
      );

      // make sure it got unbound in the db
      let channelEntity = await channelRepository.findByMultisigAddressOrThrow(multisigAddress);
      expect(channelEntity.appInstances.length).to.equal(1);

      const appProposal = createAppInstanceJson();
      await cfCoreStore.createAppProposal(
        multisigAddress,
        appProposal,
        2,
        createSetStateCommitmentJSON(),
      );

      channelEntity = await channelRepository.findByMultisigAddressOrThrow(multisigAddress);
      expect(channelEntity.appInstances.length).to.equal(2);

      for (let index = 0; index < 4; index++) {
        await cfCoreStore.removeAppProposal(multisigAddress, appProposal.identityHash);

        // make sure it got unbound in the db
        channelEntity = await channelRepository.findByMultisigAddressOrThrow(multisigAddress);
        expect(channelEntity.appInstances.length).to.equal(1);

        const channel = await cfCoreStore.getStateChannel(multisigAddress);
        expect(channel.proposedAppInstances.length).to.equal(0);
      }
    });
  });

  describe("App Instance", () => {
    it("should not create an app instance if there is no app proposal", async () => {
      const { multisigAddress, channelJson } = await createTestChannel(
        cfCoreStore,
        configService.getPublicIdentifier(),
      );

      const appInstance = createAppInstanceJson();
      const updatedFreeBalance: AppInstanceJson = {
        ...channelJson.freeBalanceAppInstance!,
        latestState: { appState: "updated" },
      };
      expect(cfCoreStore.createAppInstance(
        multisigAddress,
        appInstance,
        updatedFreeBalance,
        createSetStateCommitmentJSON(),
        createConditionalTransactionCommitmentJSON(),
      )).to.be.rejectedWith(/Could not find app with identity hash/);
    });

    it("createAppInstance", async () => {
      const APP_SEQ_NO = 2;

      const {
        multisigAddress,
        channelJson,
        userIdentifier,
        freeBalanceUpdate,
      } = await createTestChannel(cfCoreStore, configService.getPublicIdentifier());

      const appProposal = createAppInstanceJson({
        appSeqNo: APP_SEQ_NO,
        initiatorIdentifier: userIdentifier,
        responderIdentifier: configService.getPublicIdentifier(),
      });
      const setStateCommitment = createSetStateCommitmentJSON();
      await cfCoreStore.createAppProposal(
        multisigAddress,
        appProposal,
        APP_SEQ_NO,
        setStateCommitment,
      );

      const userParticipantAddr = userIdentifier;
      const nodeParticipantAddr = configService.getPublicIdentifier();

      const appInstance = createAppInstanceJson({
        appSeqNo: APP_SEQ_NO,
        identityHash: appProposal.identityHash,
        initiatorIdentifier: userParticipantAddr,
        multisigAddress,
        responderIdentifier: nodeParticipantAddr,
      });
      const updatedFreeBalance: AppInstanceJson = {
        ...channelJson.freeBalanceAppInstance!,
        latestState: { appState: "updated" },
      };
      const updatedFreeBalanceCommitment = createSetStateCommitmentJSON({
        ...freeBalanceUpdate,
        versionNumber: toBNJson(100),
      });
      const conditionalTx = createConditionalTransactionCommitmentJSON({
        appIdentityHash: appInstance.identityHash,
        contractAddresses: await configService.getContractAddresses(),
      });

      for (let index = 0; index < 3; index++) {
        await cfCoreStore.createAppInstance(
          multisigAddress,
          appInstance,
          updatedFreeBalance,
          updatedFreeBalanceCommitment,
          conditionalTx,
        );
        const app = await cfCoreStore.getAppInstance(appInstance.identityHash);
        expect(app).to.deep.equal(appInstance);

        const updatedFreeBalanceCommitmentFromStore = await cfCoreStore.getSetStateCommitment(
          channelJson.freeBalanceAppInstance.identityHash,
        );
        expect(updatedFreeBalanceCommitmentFromStore).to.deep.equal(updatedFreeBalanceCommitment);

        const conditionalTxFromStore = await cfCoreStore.getConditionalTransactionCommitment(
          appInstance.identityHash,
        );
        expect(conditionalTxFromStore).to.deep.equal(conditionalTx);

        const channel = await cfCoreStore.getStateChannel(multisigAddress);
        expect(channel).to.deep.equal({
          ...channelJson,
          freeBalanceAppInstance: updatedFreeBalance,
          appInstances: [[appInstance.identityHash, appInstance]],
          monotonicNumProposedApps: 2,
        });
      }
    });

    it("updateAppInstance", async () => {
      const { multisigAddress, appInstance } = await createTestChannelWithAppInstance(
        cfCoreStore,
        configService.getPublicIdentifier(),
      );

      const updated = createAppInstanceJson({
        ...appInstance,
        latestState: { updated: "updated app instance" },
        latestVersionNumber: 42,
        stateTimeout: toBN(1142).toHexString(),
        defaultTimeout: "0x00",
      });

      const updatedSetStateCommitment = createSetStateCommitmentJSON({
        appIdentityHash: appInstance.identityHash,
        versionNumber: toBNJson(updated.latestVersionNumber),
      });

      for (let index = 0; index < 3; index++) {
        await cfCoreStore.updateAppInstance(multisigAddress, updated, updatedSetStateCommitment);
        const app = await cfCoreStore.getAppInstance(appInstance.identityHash);
        expect(app).to.deep.equal(updated);

        const updatedSetStateCommitmentFromStore = await cfCoreStore.getSetStateCommitment(
          appInstance.identityHash,
        );
        expect(updatedSetStateCommitmentFromStore).to.deep.equal(updatedSetStateCommitment);
      }
    });

    it("removeAppInstance", async () => {
      const { multisigAddress, channelJson, appInstance } = await createTestChannelWithAppInstance(
        cfCoreStore,
        configService.getPublicIdentifier(),
      );

      const updatedFreeBalance: AppInstanceJson = {
        ...channelJson.freeBalanceAppInstance!,
        latestState: { appState: "removed app instance" },
      };
      const updatedFreeBalanceCommitment = createSetStateCommitmentJSON({
        appIdentityHash: channelJson.freeBalanceAppInstance.identityHash,
        versionNumber: toBNJson(1337),
      });

      for (let index = 0; index < 3; index++) {
        await cfCoreStore.removeAppInstance(
          multisigAddress,
          appInstance.identityHash,
          updatedFreeBalance,
          updatedFreeBalanceCommitment,
        );

        // make sure it got unbound in the db
        const channelEntity = await channelRepository.findByMultisigAddressOrThrow(multisigAddress);
        expect(channelEntity.appInstances.length).to.equal(1);

        const channel = await cfCoreStore.getStateChannel(multisigAddress);
        expect(channel.appInstances.length).to.equal(0);
        expect(channel).to.deep.equal({
          ...channelJson,
          freeBalanceAppInstance: updatedFreeBalance,
          monotonicNumProposedApps: 2,
        });
      }
    });
  });

  describe("Challenges", () => {
    it("creates a challenge", async () => {
      const { appInstance } = await createTestChannelWithAppInstance(
        cfCoreStore,
        configService.getPublicIdentifier(),
      );
      const challenge = createStoredAppChallenge({
        identityHash: appInstance.identityHash,
      });
      await cfCoreStore.saveAppChallenge(challenge);
      const retrieved = await cfCoreStore.getAppChallenge(challenge.identityHash);
      expect(retrieved).to.deep.equal(challenge);
      const byChannel = await cfCoreStore.getActiveChallenges();
      expect(byChannel).to.deep.equal([challenge]);
    });

    it("updates a challenge", async () => {
      const { challenge } = await createTestChallengeWithAppInstanceAndChannel(
        cfCoreStore,
        configService.getPublicIdentifier(),
      );
      const updated = {
        ...challenge,
        versionNumber: toBN(5),
      };
      await cfCoreStore.saveAppChallenge(updated);
      const retrieved = await cfCoreStore.getAppChallenge(challenge.identityHash);
      expect(retrieved).to.deep.equal(updated);
    });
  });

  describe("State Progressed Event", () => {
    it("creates a state progressed event", async () => {
      const { appInstance } = await createTestChallengeWithAppInstanceAndChannel(
        cfCoreStore,
        configService.getPublicIdentifier(),
      );
      const event = createStateProgressedEventPayload({
        identityHash: appInstance.identityHash,
      });
      await cfCoreStore.createStateProgressedEvent(event);
      const retrieved = await cfCoreStore.getStateProgressedEvents(appInstance.identityHash);
      expect(retrieved).to.deep.equal([event]);
    });
  });

  describe("Challenge updated Event", () => {
    it("creates a challenge updated event", async () => {
      const { appInstance } = await createTestChallengeWithAppInstanceAndChannel(
        cfCoreStore,
        configService.getPublicIdentifier(),
      );
      const event = createChallengeUpdatedEventPayload({
        identityHash: appInstance.identityHash,
      });
      await cfCoreStore.createChallengeUpdatedEvent(event);
      const retrieved = await cfCoreStore.getChallengeUpdatedEvents(appInstance.identityHash);
      expect(retrieved).to.deep.equal([event]);
    });
  });
});
