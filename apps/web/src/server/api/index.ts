/**
 * REST API client for monitoring-server
 * Using API v1
 */

export * from './types';
export { fetchAPI } from './client';

import * as authApi from './auth';
import * as organizationsApi from './organizations';
import * as projectsApi from './projects';
import * as projectSettingsApi from './projectSettings';
import * as membersApi from './members';
import * as onboardingApi from './onboarding';
import * as instanceApi from './instance';
import * as groupsApi from './groups';
import * as statsApi from './stats';
import * as apiKeysApi from './apiKeys';
import * as alertsApi from './alerts';
import * as billingApi from './billing';
import * as replayApi from './replay';
import * as userApi from './user';
import * as performanceApi from './performance';
import * as logsApi from './logs';
import * as attentionApi from './attention';
import * as cronApi from './cron';
import * as infrastructureApi from './infrastructure';

export const api = {
  auth: {
    getSession: authApi.getSession,
  },
  organizations: {
    getAll: organizationsApi.getAll,
    canCreate: organizationsApi.canCreate,
    create: organizationsApi.create,
    delete: organizationsApi.deleteOrganization,
  },
  projects: {
    getAll: projectsApi.getAll,
    getCurrent: projectsApi.getCurrent,
    setCurrent: projectsApi.setCurrent,
    canCreate: projectsApi.canCreate,
    create: projectsApi.create,
    update: projectsApi.update,
    delete: projectsApi.deleteProject,
  },
  projectSettings: {
    get: projectSettingsApi.get,
    update: projectSettingsApi.update,
  },
  members: {
    getByOrganization: membersApi.getByOrganization,
    invite: membersApi.invite,
    checkInvite: membersApi.checkInvite,
    acceptInvite: membersApi.acceptInvite,
    redeemInvite: membersApi.redeemInvite,
    remove: membersApi.remove,
  },
  instance: {
    getStatus: instanceApi.getStatus,
    bootstrap: instanceApi.bootstrap,
  },
  onboarding: {
    getStatus: onboardingApi.getStatus,
    setup: onboardingApi.setup,
  },
  groups: {
    getAll: groupsApi.getAll,
    getById: groupsApi.getById,
    getEvents: groupsApi.getEvents,
    getTimeline: groupsApi.getTimeline,
    updateStatus: groupsApi.updateStatus,
    getStatusHistory: groupsApi.getStatusHistory,
    updateAssignment: groupsApi.updateAssignment,
    getReleases: groupsApi.getReleases,
    getCorrelatedSignals: groupsApi.getCorrelatedSignals,
    merge: groupsApi.merge,
    unmerge: groupsApi.unmerge,
  },
  stats: {
    getGlobal: statsApi.getGlobal,
    getDashboardStats: statsApi.getDashboardStats,
    getTimeline: statsApi.getTimeline,
    getEnvBreakdown: statsApi.getEnvBreakdown,
    getSeverityBreakdown: statsApi.getSeverityBreakdown,
  },
  apiKeys: {
    getAll: apiKeysApi.getAll,
    create: apiKeysApi.create,
    delete: apiKeysApi.deleteApiKey,
  },
  alerts: {
    getRules: alertsApi.getRules,
    createRule: alertsApi.createRule,
    updateRule: alertsApi.updateRule,
    deleteRule: alertsApi.deleteRule,
    getNotifications: alertsApi.getNotifications,
  },
  billing: {
    getSummary: billingApi.getSummary,
    createCheckout: billingApi.createCheckout,
    createPortal: billingApi.createPortal,
  },
  replay: {
    getSessions: replayApi.getSessions,
    getSessionsWithErrors: replayApi.getSessionsWithErrors,
    getSession: replayApi.getSession,
    getSessionEvents: replayApi.getSessionEvents,
  },
  user: {
    getProfile: userApi.getProfile,
    updateProfile: userApi.updateProfile,
    getSessions: userApi.getSessions,
    revokeSession: userApi.revokeSession,
    revokeAllSessions: userApi.revokeAllSessions,
    canChangePassword: userApi.canChangePassword,
  },
  performance: {
    getTransactions: performanceApi.getTransactions,
    getTransaction: performanceApi.getTransaction,
    getSlowest: performanceApi.getSlowest,
    getSpanAnalysis: performanceApi.getSpanAnalysis,
    getApdex: performanceApi.getApdex,
    getServerStats: performanceApi.getServerStats,
    getTopEndpoints: performanceApi.getTopEndpoints,
    getThroughputTimeline: performanceApi.getThroughputTimeline,
    getDurationTimeline: performanceApi.getDurationTimeline,
    getExternalCalls: performanceApi.getExternalCalls,
    getCache: performanceApi.getCache,
    getQueues: performanceApi.getQueues,
    getEndpointDetail: performanceApi.getEndpointDetail,
  },
  logs: {
    tail: logsApi.tail,
    stats: logsApi.stats,
  },
  attention: {
    getTop: attentionApi.getTop,
  },
  cron: {
    getMonitors: cronApi.getMonitors,
    getMonitor: cronApi.getMonitor,
    createMonitor: cronApi.createMonitor,
    updateMonitor: cronApi.updateMonitor,
    deleteMonitor: cronApi.deleteMonitor,
    getCheckins: cronApi.getCheckins,
    getTimeline: cronApi.getTimeline,
  },
  infrastructure: {
    getHosts: infrastructureApi.getHosts,
    getLatest: infrastructureApi.getLatest,
    getHistory: infrastructureApi.getHistory,
  },
};
