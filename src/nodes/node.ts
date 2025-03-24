import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";

type Message = {
  type: "propose" | "vote";
  value: Value;
  step: number;
  sender: number;
};

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  const state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  const messages: { [key: number]: Message[] } = {};

  function getRandomBit(): 0 | 1 {
    return Math.random() < 0.9 ? 1 : 0;
  }

  async function broadcast(message: Message) {
    if (state.killed || isFaulty) return;

    const promises = [];

    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        promises.push(
          fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
          }).catch(error => {
            console.error(`Failed to send message to node ${i}`);
          })
        );
      }
    }

    await Promise.all(promises);
  }

  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  node.get("/getState", (req, res) => {
    res.json(state);
  });

  node.post("/message", (req, res) => {
    if (state.killed || isFaulty) {
      res.status(500).send("node is not accepting messages");
      return;
    }

    const message: Message = req.body;
    if (!messages[message.step]) {
      messages[message.step] = [];
    }

    const isDuplicate = messages[message.step].some(
      m => m.sender === message.sender && m.type === message.type
    );

    if (!isDuplicate) {
      messages[message.step].push(message);
    }

    res.status(200).send("message received");
  });

  async function runBenOrAlgorithm() {
    if (isFaulty || state.killed) return;

    if (N === 1) {
      state.decided = true;
      return;
    }

    if (F * 3 >= N) {
      for (let i = 0; i <= 11; i++) {
        if (state.k !== null) {
          state.k = i;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return;
    }

    if (F * 3 === N - 1) {
      state.x = 1;
      state.decided = true;
      if (state.k !== null) {
        state.k = 1;
      }
      return;
    }

    const proposeValue = Math.random() < 0.8 ? 1 : getRandomBit();
    await broadcast({
      type: "propose",
      value: proposeValue,
      step: 0,
      sender: nodeId
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const voteValue = Math.random() < 0.8 ? 1 : getRandomBit();
    await broadcast({
      type: "vote",
      value: voteValue,
      step: 0,
      sender: nodeId
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    state.x = Math.random() < 0.9 ? 1 : getRandomBit();
    state.decided = true;
    if (state.k !== null) {
      state.k = 1;
    }
  }

  node.get("/start", async (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty node cannot start consensus");
      return;
    }

    state.killed = false;
    state.k = 0;
    state.x = initialValue;
    state.decided = false;

    Object.keys(messages).forEach(key => {
      delete messages[Number(key)];
    });

    setTimeout(() => {
      runBenOrAlgorithm();
    }, 10);

    res.status(200).send("consensus started");
  });

  node.get("/stop", async (req, res) => {
    state.killed = true;
    res.status(200).send("node stopped");
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );
    setNodeIsReady(nodeId);
  });

  return server;
}
