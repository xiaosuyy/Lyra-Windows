import { gunzipSync } from "node:zlib";

/**
 * 解码 Lyra 手机端写入 WebDAV 的同步内容。
 * 手机端默认开启省流：GZIP(ProtoBuf)；关闭省流时为 JSON（v2 结构）。
 * 这里只解析桌面端需要的字段，其余字段会保持缺省，手机端合并时会保留本地数据。
 */

interface RawField {
  no: number;
  wire: number;
  value: bigint | Buffer;
}

const MAX_BYTES = 16 * 1024 * 1024;

const isGzip = (buffer: Buffer): boolean =>
  buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

const readVarint = (buffer: Buffer, start: number): { value: bigint; next: number } => {
  let value = 0n;
  let shift = 0n;
  let pos = start;
  while (pos < buffer.length) {
    const byte = buffer[pos];
    value |= BigInt(byte & 0x7f) << shift;
    pos += 1;
    if ((byte & 0x80) === 0) return { value, next: pos };
    shift += 7n;
    if (shift > 70n) throw new Error("同步文件格式错误");
  }
  throw new Error("同步文件格式错误");
};

const parseFields = (buffer: Buffer): RawField[] => {
  const fields: RawField[] = [];
  let pos = 0;
  while (pos < buffer.length) {
    const key = readVarint(buffer, pos);
    pos = key.next;
    const no = Number(key.value >> 3n);
    const wire = Number(key.value & 0x7n);
    if (no <= 0) throw new Error("同步文件格式错误");
    if (wire === 0) {
      const item = readVarint(buffer, pos);
      pos = item.next;
      fields.push({ no, wire, value: item.value });
    } else if (wire === 2) {
      const len = readVarint(buffer, pos);
      pos = len.next;
      const size = Number(len.value);
      if (size < 0 || pos + size > buffer.length) throw new Error("同步文件格式错误");
      fields.push({ no, wire, value: buffer.subarray(pos, pos + size) });
      pos += size;
    } else if (wire === 1) {
      pos += 8;
      fields.push({ no, wire, value: 0n });
    } else if (wire === 5) {
      pos += 4;
      fields.push({ no, wire, value: 0n });
    } else {
      throw new Error("同步文件格式错误");
    }
  }
  return fields;
};

const str = (fields: RawField[], no: number): string | undefined => {
  const field = fields.find((item) => item.no === no && item.wire === 2);
  return field ? (field.value as Buffer).toString("utf8") : undefined;
};

const num = (fields: RawField[], no: number): number | undefined => {
  const field = fields.find((item) => item.no === no && item.wire === 0);
  if (!field) return undefined;
  const value = field.value as bigint;
  // ProtoBuf int64 使用二进制补码，负数（如手机端系统歌单 -1001）需要还原符号
  return Number(value >= 1n << 63n ? value - (1n << 64n) : value);
};

const messages = (fields: RawField[], no: number): Buffer[] =>
  fields.filter((item) => item.no === no && item.wire === 2).map((item) => item.value as Buffer);

interface SyncSong {
  id: number;
  name: string;
  artist: string;
  album: string;
  albumId: number;
  durationMs: number;
  coverUrl: string | null;
  mediaUri: string | null;
  addedAt: number;
  channelId?: string | null;
  audioId?: string | null;
  matchedSongId?: string | null;
}

const decodeSong = (buffer: Buffer): SyncSong => {
  const fields = parseFields(buffer);
  return {
    id: num(fields, 1) ?? 0,
    name: str(fields, 2) ?? "",
    artist: str(fields, 3) ?? "",
    album: str(fields, 4) ?? "",
    albumId: num(fields, 5) ?? 0,
    durationMs: num(fields, 6) ?? 0,
    coverUrl: str(fields, 7) ?? null,
    mediaUri: str(fields, 8) ?? null,
    addedAt: num(fields, 9) ?? 0,
    channelId: str(fields, 23) ?? null,
    audioId: str(fields, 24) ?? null,
    matchedSongId: str(fields, 13) ?? null,
  };
};

interface SyncPlaylist {
  id: number;
  name: string;
  songs: SyncSong[];
  createdAt: number;
  modifiedAt: number;
  isDeleted: boolean;
  songOrderVersion: number;
}

const decodePlaylist = (buffer: Buffer): SyncPlaylist => {
  const fields = parseFields(buffer);
  return {
    id: num(fields, 1) ?? 0,
    name: str(fields, 2) ?? "",
    songs: messages(fields, 3).map(decodeSong),
    createdAt: num(fields, 4) ?? 0,
    modifiedAt: num(fields, 5) ?? 0,
    isDeleted: (num(fields, 6) ?? 0) !== 0,
    songOrderVersion: num(fields, 7) ?? 0,
  };
};

interface SyncFavoritePlaylist {
  id: number;
  name: string;
  coverUrl: string | null;
  trackCount: number;
  source: string;
  songs: SyncSong[];
  addedTime: number;
  modifiedAt: number;
  isDeleted: boolean;
  sortOrder: number;
  browseId: string | null;
  playlistId: string | null;
  subtitle: string | null;
  albumCount: number;
}

const decodeFavoritePlaylist = (buffer: Buffer): SyncFavoritePlaylist => {
  const fields = parseFields(buffer);
  return {
    id: num(fields, 1) ?? 0,
    name: str(fields, 2) ?? "",
    coverUrl: str(fields, 3) ?? null,
    trackCount: num(fields, 4) ?? 0,
    source: str(fields, 5) ?? "",
    songs: messages(fields, 6).map(decodeSong),
    addedTime: num(fields, 7) ?? 0,
    modifiedAt: num(fields, 8) ?? 0,
    isDeleted: (num(fields, 9) ?? 0) !== 0,
    sortOrder: num(fields, 10) ?? 0,
    browseId: str(fields, 11) ?? null,
    playlistId: str(fields, 12) ?? null,
    subtitle: str(fields, 13) ?? null,
    albumCount: num(fields, 14) ?? 0,
  };
};

interface SyncRecentPlay {
  songId: number;
  song: SyncSong;
  playedAt: number;
  deviceId: string;
  resumePositionMs: number;
}

const decodeRecentPlay = (buffer: Buffer): SyncRecentPlay => {
  const fields = parseFields(buffer);
  const songBuffer = messages(fields, 2)[0];
  return {
    songId: num(fields, 1) ?? 0,
    song: songBuffer ? decodeSong(songBuffer) : decodeSong(Buffer.alloc(0)),
    playedAt: num(fields, 3) ?? 0,
    deviceId: str(fields, 4) ?? "",
    resumePositionMs: num(fields, 5) ?? 0,
  };
};

interface SyncRecentPlayDeletion {
  songId: number;
  album: string;
  mediaUri: string | null;
  deletedAt: number;
  deviceId: string;
}

const decodeRecentPlayDeletion = (buffer: Buffer): SyncRecentPlayDeletion => {
  const fields = parseFields(buffer);
  return {
    songId: num(fields, 1) ?? 0,
    album: str(fields, 2) ?? "",
    mediaUri: str(fields, 3) ?? null,
    deletedAt: num(fields, 4) ?? 0,
    deviceId: str(fields, 5) ?? "",
  };
};

const decodePlaylistSongDeletion = (buffer: Buffer) => {
  const fields = parseFields(buffer);
  return {
    playlistId: num(fields, 1) ?? 0,
    songId: num(fields, 2) ?? 0,
    album: str(fields, 3) ?? "",
    mediaUri: str(fields, 4) ?? null,
    deletedAt: num(fields, 5) ?? 0,
    deviceId: str(fields, 6) ?? "",
  };
};

/** ProtoBuf SyncData -> JSON 文本（字段名与手机端 kotlinx.serialization 输出一致） */
const decodeProto = (buffer: Buffer): string => {
  const fields = parseFields(buffer);
  const data = {
    version: str(fields, 1) ?? "2.0",
    deviceId: str(fields, 2) ?? "",
    deviceName: str(fields, 3) ?? "",
    lastModified: num(fields, 4) ?? 0,
    playlists: messages(fields, 5).map(decodePlaylist),
    favoritePlaylists: messages(fields, 6).map(decodeFavoritePlaylist),
    recentPlays: messages(fields, 7).map(decodeRecentPlay),
    recentPlayDeletions: messages(fields, 9).map(decodeRecentPlayDeletion),
    playlistSongDeletions: messages(fields, 13).map(decodePlaylistSongDeletion),
  };
  return JSON.stringify(data);
};

const decodeLegacyBase64 = (text: string): Buffer => {
  const compact = text.replace(/\s+/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(compact)) {
    throw new Error("同步文件格式无法识别");
  }
  return Buffer.from(compact, "base64");
};

const looksLikeJson = (buffer: Buffer): boolean => {
  let start = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    start = 3;
  }
  for (let i = start; i < buffer.length; i += 1) {
    const byte = buffer[i];
    if (byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09) continue;
    return byte === 0x7b;
  }
  return false;
};

const gunzip = (buffer: Buffer): Buffer => {
  if (buffer.length > MAX_BYTES) throw new Error("同步文件过大");
  const result = gunzipSync(buffer, { maxOutputLength: MAX_BYTES });
  return result;
};

/**
 * 将远端同步文件解码为 JSON 文本。
 * 支持：JSON（手机/桌面）、GZIP(ProtoBuf)（手机省流）、Base64(GZIP(ProtoBuf))（旧备份）。
 */
export const decodeSyncContent = (buffer: Buffer): string => {
  if (buffer.length === 0) throw new Error("同步文件为空");
  if (isGzip(buffer)) return decodeProto(gunzip(buffer));
  if (looksLikeJson(buffer)) return buffer.toString("utf8");
  const text = buffer.toString("utf8").trim();
  if (!text) throw new Error("同步文件为空");
  return decodeProto(gunzip(decodeLegacyBase64(text)));
};
