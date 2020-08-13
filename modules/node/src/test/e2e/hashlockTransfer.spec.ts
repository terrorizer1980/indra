import { ColorfulLogger, logTime, getRandomBytes32, delay } from "@connext/utils";
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  IConnextClient,
  ConditionalTransferCreatedEventData,
  ConditionalTransferTypes,
  EventNames,
  CONVENTION_FOR_ETH_ASSET_ID,
} from "@connext/types";
import { utils, BigNumber } from "ethers";

import { AppModule } from "../../app.module";
import { ConfigService } from "../../config/config.service";
import {
  env,
  ethProviderUrl,
  expect,
  MockConfigService,
  getClient,
  AssetOptions,
  fundChannel,
  ethProvider,
  ETH_AMOUNT_SM,
} from "../utils";
import { TIMEOUT_BUFFER } from "../../constants";
import { TransferService } from "../../transfer/transfer.service";

const { soliditySha256 } = utils;

// Define helper functions
const sendHashlockTransfer = async (
  sender: IConnextClient,
  receiver: IConnextClient,
  transfer: AssetOptions & { preImage: string; timelock: string },
): Promise<ConditionalTransferCreatedEventData<"HashLockTransferApp">> => {
  // Fund sender channel
  await fundChannel(sender, transfer.amount, transfer.assetId);

  // Create transfer parameters
  const expiry = BigNumber.from(transfer.timelock).add(await ethProvider.getBlockNumber());
  const lockHash = soliditySha256(["bytes32"], [transfer.preImage]);

  const receiverPromise = receiver.waitFor(EventNames.CONDITIONAL_TRANSFER_CREATED_EVENT, 10_000);
  // sender result
  const senderResult = await sender.conditionalTransfer({
    amount: transfer.amount.toString(),
    conditionType: ConditionalTransferTypes.HashLockTransfer,
    lockHash,
    timelock: transfer.timelock,
    assetId: transfer.assetId,
    meta: { foo: "bar" },
    recipient: receiver.publicIdentifier,
  });
  const receiverEvent = await receiverPromise;
  console.log("receiverEvent: ", receiverEvent);
  const paymentId = soliditySha256(["address", "bytes32"], [transfer.assetId, lockHash]);
  const expectedVals = {
    amount: transfer.amount,
    assetId: transfer.assetId,
    paymentId,
    recipient: receiver.publicIdentifier,
    sender: sender.publicIdentifier,
    transferMeta: {
      timelock: transfer.timelock,
      lockHash,
      expiry: expiry.sub(TIMEOUT_BUFFER),
    },
  };
  // verify the receiver event
  expect(receiverEvent).to.containSubset({
    ...expectedVals,
    type: ConditionalTransferTypes.HashLockTransfer,
  });

  // verify sender return value
  expect(senderResult).to.containSubset({
    ...expectedVals,
    transferMeta: {
      ...expectedVals.transferMeta,
      expiry,
    },
  });
  return receiverEvent as ConditionalTransferCreatedEventData<"HashLockTransferApp">;
};

describe("Hashlock Transfer", () => {
  const log = new ColorfulLogger("TestStartup", env.logLevel, true, "T");

  let app: INestApplication;
  let configService: ConfigService;
  let transferService: TransferService;
  let senderClient: IConnextClient;
  let receiverClient: IConnextClient;

  before(async () => {
    const start = Date.now();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useClass(MockConfigService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    configService = moduleFixture.get<ConfigService>(ConfigService);
    await app.listen(configService.getPort());

    log.info(`node: ${await configService.getSignerAddress()}`);
    log.info(`ethProviderUrl: ${ethProviderUrl}`);

    senderClient = await getClient("A");
    console.log("senderClient: ", senderClient.publicIdentifier);

    receiverClient = await getClient("B");
    console.log("receiverClient: ", receiverClient.publicIdentifier);

    logTime(log, start, "Done setting up test env");
    transferService = moduleFixture.get<TransferService>(TransferService);
  });

  after(async () => {
    try {
      await app.close();
      log.info(`Application was shutdown successfully`);
    } catch (e) {
      log.warn(`Application was shutdown unsuccessfully: ${e.message}`);
    }
  });

  it.only("cleans up expired hashlock transfers ", async () => {
    const transfer: AssetOptions = { amount: ETH_AMOUNT_SM, assetId: CONVENTION_FOR_ETH_ASSET_ID };
    const preImage = getRandomBytes32();
    console.log("preImage: ", preImage);
    const timelock = (101).toString();
    const opts = { ...transfer, preImage, timelock };

    const { paymentId } = await sendHashlockTransfer(senderClient, receiverClient, opts);

    console.log("paymentId: ", paymentId);
    expect(paymentId).to.be.ok;

    const appsBeforePrune = await senderClient.getAppInstances();
    console.log("appsBeforePrune: ", appsBeforePrune);
    await transferService.pruneChannels();
    const appsAfterPrune = await senderClient.getAppInstances();
    console.log("appsAfterPrune: ", appsAfterPrune);
  });
});
