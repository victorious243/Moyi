const mongoose = require('mongoose');
const Project = require('../models/Project');
const SocialAccount = require('../models/SocialAccount');
const SocialDraft = require('../models/SocialDraft');
const { socialAccountAccessFilter } = require('./socialAccountService');
const { createBlotatoCampaign, publishBlotatoCampaign } = require('./blotatoEngineService');
const { canManageProjectRole, projectAccessRole } = require('./projectAccessService');

async function authorizedProject(projectId, userId, { manage = false } = {}) {
  if (!mongoose.isValidObjectId(projectId)) {
    const error = new Error('A valid Moyi project ID is required.');
    error.statusCode = 422;
    throw error;
  }
  const project = await Project.findById(projectId);
  const role = project ? await projectAccessRole({ project, userId }) : '';
  if (!project || !role) {
    const error = new Error('Project not found.');
    error.statusCode = 404;
    throw error;
  }
  if (manage && !canManageProjectRole(role)) {
    const error = new Error('You do not have permission to change or publish this project.');
    error.statusCode = 403;
    throw error;
  }
  return project;
}

/**
 * Returns the list of standard Model Context Protocol (MCP) tools provided by Blotato / Moyi Engine.
 */
function listMcpTools() {
  return [
    {
      name: 'blotato_connect_status',
      description: 'Fetch the connection status of all social accounts (LinkedIn, X, Meta, YouTube).',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Target Moyi Project ID' }
        },
        required: ['projectId']
      }
    },
    {
      name: 'blotato_create_campaign',
      description: 'Generate multi-platform social drafts (LinkedIn, X, Meta, YouTube) from a topic, URL, or master text.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Target Moyi Project ID' },
          topic: { type: 'string', description: 'Campaign title or topic' },
          body: { type: 'string', description: 'Master post content copy' },
          url: { type: 'string', description: 'Optional link URL' }
        },
        required: ['projectId', 'topic']
      }
    },
    {
      name: 'blotato_publish_all',
      description: 'Queue human-approved drafts across connected native channels for a project or campaign.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Target Moyi Project ID' },
          campaignId: { type: 'string', description: 'Optional specific Campaign ID' }
        },
        required: ['projectId']
      }
    },
    {
      name: 'blotato_fetch_analytics',
      description: 'Fetch aggregate post publishing status and engagement analytics.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Target Moyi Project ID' }
        },
        required: ['projectId']
      }
    }
  ];
}

/**
 * Handles incoming MCP tool execution calls from AI agents (Codex, Claude, ChatGPT, Cursor).
 */
async function handleMcpToolCall({ toolName, params, userId }) {
  const projectId = params && params.projectId;

  switch (toolName) {
    case 'blotato_connect_status': {
      await authorizedProject(projectId, userId);
      const accounts = await SocialAccount.find({
        projectId,
        ...socialAccountAccessFilter(userId)
      });
      return {
        success: true,
        connectedCount: accounts.length,
        accounts: accounts.map((a) => ({
          id: a._id,
          platform: a.platform,
          name: a.accountName,
          status: a.status
        }))
      };
    }

    case 'blotato_create_campaign': {
      await authorizedProject(projectId, userId, { manage: true });
      const result = await createBlotatoCampaign({
        projectId,
        userId,
        topic: params.topic,
        url: params.url || '',
        title: params.topic,
        body: params.body || params.topic
      });
      return {
        success: true,
        campaignId: result.campaign._id,
        draftsCreated: result.drafts.length,
        platforms: result.drafts.map((draft) => draft.channel),
        reviewRequired: true
      };
    }

    case 'blotato_publish_all': {
      const project = await authorizedProject(projectId, userId, { manage: true });
      const result = await publishBlotatoCampaign({
        projectId,
        userId,
        campaignId: params.campaignId || null,
        project
      });
      return {
        success: true,
        queuedCount: result.queuedCount || 0,
        publishedCount: result.successCount || 0,
        failedCount: result.failedCount || 0,
        errors: result.errors || [],
        reviewRequired: Boolean(result.requiresApproval)
      };
    }

    case 'blotato_fetch_analytics': {
      await authorizedProject(projectId, userId);
      const totalDrafts = await SocialDraft.countDocuments({ projectId });
      const published = await SocialDraft.countDocuments({ projectId, publishStatus: 'published' });
      return {
        success: true,
        totalDrafts,
        publishedCount: published,
        pendingCount: totalDrafts - published
      };
    }

    default:
      throw new Error(`Unknown MCP tool name: ${toolName}`);
  }
}

module.exports = {
  authorizedProject,
  listMcpTools,
  handleMcpToolCall
};
