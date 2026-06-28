import { getClerkToken } from '@/services/clerk';
import { SITE_VARIANT } from '@/config/variant';

export type ChannelType = 'telegram' | 'slack' | 'email' | 'discord' | 'webhook' | 'web_push';
export type Sensitivity = 'all' | 'high' | 'critical';
export type QuietHoursOverride = 'critical_only' | 'silence_all' | 'batch_on_wake';
export type DigestMode = 'realtime' | 'daily' | 'twice_daily' | 'weekly';

export interface NotificationChannel {
  channelType: ChannelType;
  verified: boolean;
  linkedAt: number;
  chatId?: string;
  email?: string;
  slackChannelName?: string;
  slackTeamName?: string;
  slackConfigurationUrl?: string;
  webhookLabel?: string;
  // web_push identity fields
  endpoint?: string;
  p256dh?: string;
  auth?: string;
  userAgent?: string;
}

export interface AlertRule {
  variant: string;
  enabled: boolean;
  eventTypes: string[];
  sensitivity: Sensitivity;
  channels: ChannelType[];
  quietHoursEnabled?: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  quietHoursTimezone?: string;
  quietHoursOverride?: QuietHoursOverride;
  digestMode?: DigestMode;
  digestHour?: number;
  digestTimezone?: string;
  aiDigestEnabled?: boolean;
  // Optional country-scope (ISO-3166 alpha-2). Empty/absent → all countries.
  countries?: string[];
}

export interface ChannelsData {
  channels: NotificationChannel[];
  alertRules: AlertRule[];
}

let localChannelsData: ChannelsData = {
  channels: [
    { channelType: 'telegram', verified: true, linkedAt: Date.now() - 86400000, chatId: 'pro_user_tg' },
    { channelType: 'email', verified: true, linkedAt: Date.now() - 86400000, email: 'pakistanboy9990@gmail.com' }
  ],
  alertRules: [
    {
      variant: SITE_VARIANT,
      enabled: true,
      eventTypes: [],
      sensitivity: 'critical',
      channels: ['telegram', 'email'],
      quietHoursEnabled: false,
      digestMode: 'realtime',
      digestHour: 8,
      aiDigestEnabled: true,
      countries: []
    }
  ]
};

export async function getChannelsData(): Promise<ChannelsData> {
  return localChannelsData;
}

export async function createPairingToken(): Promise<{ token: string; expiresAt: number }> {
  return { token: 'wm_pair_' + Math.floor(Math.random() * 1000000), expiresAt: Date.now() + 600000 };
}

export async function setEmailChannel(email: string): Promise<void> {
  const ch = localChannelsData.channels.find(c => c.channelType === 'email');
  if (ch) { ch.verified = true; ch.email = email; }
  else { localChannelsData.channels.push({ channelType: 'email', verified: true, linkedAt: Date.now(), email }); }
}

export async function setSlackChannel(webhookEnvelope: string): Promise<void> {
  const ch = localChannelsData.channels.find(c => c.channelType === 'slack');
  if (ch) { ch.verified = true; ch.slackChannelName = '#alerts'; }
  else { localChannelsData.channels.push({ channelType: 'slack', verified: true, linkedAt: Date.now(), slackChannelName: '#alerts' }); }
}

export async function setWebhookChannel(webhookUrl: string, label?: string): Promise<void> {
  const ch = localChannelsData.channels.find(c => c.channelType === 'webhook');
  if (ch) { ch.verified = true; ch.webhookLabel = label || webhookUrl; }
  else { localChannelsData.channels.push({ channelType: 'webhook', verified: true, linkedAt: Date.now(), webhookLabel: label || webhookUrl }); }
}

export async function startSlackOAuth(): Promise<string> {
  return 'https://slack.com/oauth/v2/authorize?client_id=mock&scope=incoming-webhook';
}

export async function startDiscordOAuth(): Promise<string> {
  return 'https://discord.com/api/oauth2/authorize?client_id=mock&permissions=2048&scope=bot';
}

export async function deleteChannel(channelType: ChannelType): Promise<void> {
  localChannelsData.channels = localChannelsData.channels.filter(c => c.channelType !== channelType);
}

export async function saveAlertRules(rules: AlertRule): Promise<void> {
  localChannelsData.alertRules = [rules];
}

export async function setQuietHours(settings: any): Promise<void> {
  if (localChannelsData.alertRules[0]) {
    Object.assign(localChannelsData.alertRules[0], settings);
  }
}

export async function setDigestSettings(settings: any): Promise<void> {
  if (localChannelsData.alertRules[0]) {
    Object.assign(localChannelsData.alertRules[0], settings);
  }
}

export class IncompatibleDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleDeliveryError';
  }
}

export async function setNotificationConfig(args: any): Promise<void> {
  if (localChannelsData.alertRules[0]) {
    Object.assign(localChannelsData.alertRules[0], args);
  }
}
