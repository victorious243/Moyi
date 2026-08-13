const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Project = require('../models/Project');

const {
  formatBlotatoMultiPlatformPayloads,
  createBlotatoCampaign
} = require('../services/blotatoEngineService');

const {
  listMcpTools,
  handleMcpToolCall
} = require('../services/mcpServerService');

test.before(async () => {
  if (mongoose.connection.readyState === 0) {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/moyi';
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 1500 });
    } catch (error) {
      // Offline fallback
    }
  }
});

test('blotatoEngineService: formats platform-native payloads for 5 social channels', () => {
  const payloads = formatBlotatoMultiPlatformPayloads({
    title: 'Product Launch 2.0',
    body: 'We are launching our new Blotato engine feature today!',
    url: 'https://example.com/launch'
  });

  assert.equal(payloads.length, 5);
  
  const linkedin = payloads.find((p) => p.channel === 'linkedin');
  assert.ok(linkedin.body.includes('#Growth'));
  assert.ok(linkedin.body.includes('Product Launch 2.0'));

  const twitter = payloads.find((p) => p.channel === 'x');
  assert.ok(twitter.body.length <= 280);

  const meta = payloads.find((p) => p.channel === 'facebook');
  assert.ok(meta.body.includes('🚀 Product Launch 2.0'));
});

test('mcpServerService: lists standard MCP tools for AI agents', () => {
  const tools = listMcpTools();
  assert.ok(tools.length >= 4);

  const connectTool = tools.find((t) => t.name === 'blotato_connect_status');
  assert.ok(connectTool);
  assert.equal(connectTool.parameters.required[0], 'projectId');

  const createTool = tools.find((t) => t.name === 'blotato_create_campaign');
  assert.ok(createTool);

  const publishTool = tools.find((t) => t.name === 'blotato_publish_all');
  assert.ok(publishTool);
});

test('mcpServerService: handles blotato_connect_status tool call in sandbox', async () => {
  if (mongoose.connection.readyState !== 1) return;

  const projectId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  await Project.create({
    _id: projectId,
    owner: userId,
    name: 'MCP publishing test',
    websiteUrl: 'https://mcp-test.example'
  });

  try {
    const result = await handleMcpToolCall({
      toolName: 'blotato_connect_status',
      params: { projectId: projectId.toString() },
      userId
    });

    assert.equal(result.success, true);
    assert.equal(result.connectedCount, 0);
  } finally {
    await Project.deleteOne({ _id: projectId });
  }
});
