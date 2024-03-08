import { delay, setUp } from "./utils.ts";
import { KUPMIOS_ENV } from "./constants.ts";
import { BLOCKFROST_ENV } from "./constants.ts";
import { LOCAL_ENV } from "./constants.ts";
import { createDeployment } from "./create_deployment.ts";
import { createClient } from "./create_client.ts";
import { updateClient } from "./update_client.ts";
import {
  connOpenInit,
  op as connOpenInitOp,
} from "./connection/conn_open_init.ts";
import {
  connOpenTry,
  op as connOpenTryOp,
} from "./connection/conn_open_try.ts";
import {
  connOpenAck,
  op as connOpenAckOp,
} from "./connection/conn_open_ack.ts";
import {
  connOpenConfirm,
  op as connOpenConfirmOp,
} from "./connection/conn_open_confirm.ts";
import {
  chanOpenInit,
  op as chanOpenInitOp,
} from "./channel/chan_open_init.ts";
import { chanOpenTry, op as chanOpTryOp } from "./channel/chan_open_try.ts";
import { chanOpenAck, op as chanOpenAckOp } from "./channel/chan_open_ack.ts";
import {
  chanOpenConfirm,
  op as chanOpenConfirmOp,
} from "./channel/chan_open_confirm.ts";
// deno-lint-ignore no-unused-vars
import { bindPort, op as bindPortOp } from "./bind_port.ts";
import { op as recvPacketOp, recvPacket } from "./apps/mock/recv_packet.ts";

if (Deno.args.length < 1) throw new Error("Missing script params");
const MODE = Deno.args[0];

const { lucid, provider } = await setUp(MODE);

console.log("=".repeat(70));
const deploymentInfo = await createDeployment(lucid, provider, MODE);

await callWithDelay(async () => {
  await createClient(lucid, deploymentInfo);
});

await callWithDelay(async () => {
  await updateClient(lucid, deploymentInfo);
});

await callWithDelay(async () => {
  await connOpenInit(lucid, deploymentInfo, connOpenInitOp);
});

await callWithDelay(async () => {
  await connOpenTry(lucid, deploymentInfo, connOpenTryOp);
});

await callWithDelay(async () => {
  await connOpenAck(lucid, deploymentInfo, connOpenAckOp);
});

await callWithDelay(async () => {
  await connOpenConfirm(lucid, deploymentInfo, connOpenConfirmOp);
});

// await callWithDelay(async () => {
//   await bindPort(lucid, deploymentInfo, bindPortOp);
// });

await callWithDelay(async () => {
  await chanOpenInit(lucid, deploymentInfo, chanOpenInitOp);
});

await callWithDelay(async () => {
  await chanOpenTry(lucid, deploymentInfo, chanOpTryOp);
});

await callWithDelay(async () => {
  await chanOpenAck(lucid, deploymentInfo, chanOpenAckOp);
});

await callWithDelay(async () => {
  await chanOpenConfirm(lucid, deploymentInfo, chanOpenConfirmOp);
});

await callWithDelay(async () => {
  await recvPacket(lucid, deploymentInfo, recvPacketOp);
});

Deno.exit();

async function callWithDelay(fn: () => Promise<void>) {
  console.log("=".repeat(70));
  if (MODE == BLOCKFROST_ENV) {
    await delay(30);
  } else if (MODE == KUPMIOS_ENV || MODE == LOCAL_ENV) {
    await delay(10);
  }

  await fn();
}
