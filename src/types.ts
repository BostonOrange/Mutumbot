// Discord Interaction Types
export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: InteractionType;
  data?: InteractionData;
  guild_id?: string;
  channel_id?: string;
  member?: GuildMember;
  user?: User;
  token: string;
  version: number;
  message?: Message;
}

export interface InteractionData {
  id: string;
  name: string;
  type: number;
  resolved?: ResolvedData;
  options?: ApplicationCommandOption[];
  custom_id?: string;
  component_type?: number;
  values?: string[];
  target_id?: string;
}

export interface ApplicationCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: ApplicationCommandOption[];
  focused?: boolean;
}

export interface ResolvedData {
  users?: Record<string, User>;
  members?: Record<string, GuildMember>;
  channels?: Record<string, Channel>;
  attachments?: Record<string, Attachment>;
}

export interface User {
  id: string;
  username: string;
  discriminator: string;
  avatar?: string;
  bot?: boolean;
}

export interface GuildMember {
  user?: User;
  nick?: string;
  roles: string[];
  joined_at: string;
}

export interface Channel {
  id: string;
  type: number;
  name?: string;
}

export interface Message {
  id: string;
  channel_id: string;
  content: string;
  attachments: Attachment[];
}

export interface Attachment {
  id: string;
  filename: string;
  content_type?: string;
  size: number;
  url: string;
  proxy_url: string;
  width?: number;
  height?: number;
}

export enum InteractionType {
  PING = 1,
  APPLICATION_COMMAND = 2,
  MESSAGE_COMPONENT = 3,
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
  MODAL_SUBMIT = 5,
}

export enum InteractionResponseType {
  PONG = 1,
  CHANNEL_MESSAGE_WITH_SOURCE = 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5,
  DEFERRED_UPDATE_MESSAGE = 6,
  UPDATE_MESSAGE = 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT = 8,
  MODAL = 9,
}

export interface InteractionResponse {
  type: InteractionResponseType;
  data?: InteractionResponseData;
}

export interface InteractionResponseData {
  content?: string;
  embeds?: Embed[];
  flags?: number;
  components?: Component[];
}

export interface Embed {
  title?: string;
  description?: string;
  color?: number;
  fields?: EmbedField[];
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
  thumbnail?: { url: string };
  image?: { url: string };
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Component {
  type: number;
  components?: Component[];
  style?: number;
  label?: string;
  emoji?: { name: string; id?: string };
  custom_id?: string;
  url?: string;
  disabled?: boolean;
  options?: SelectOption[];
  placeholder?: string;
  min_values?: number;
  max_values?: number;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: { name: string; id?: string };
  default?: boolean;
}

// Beer tracking types
export interface BeerPost {
  userId: string;
  username: string;
  timestamp: string;
  imageUrl?: string;
  guildId: string;
}

export interface FridayStatus {
  date: string;
  hasBeerPost: boolean;
  posts: BeerPost[];
}
