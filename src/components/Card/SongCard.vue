<template>
  <div class="song-card">
    <div :class="['song-content', { play: musicStore.playSong.id === song.id }]">
      <!-- 序号 -->
      <span v-if="index !== undefined" class="track-index">{{ index + 1 }}</span>
      <!-- 标题 -->
      <div class="title">
        <!-- 信息 -->
        <n-flex size="small" class="info" vertical>
          <!-- 名称 -->
          <div class="name">
            <n-ellipsis
              :line-clamp="1"
              :tooltip="{
                placement: 'top',
                width: 'trigger',
              }"
              class="name-text"
            >
              {{
                settingStore.hideBracketedContent
                  ? removeBrackets(song?.name)
                  : song?.name || "未知曲目"
              }}
              <n-text
                v-if="song.alia?.length && !settingStore.hideBracketedContent"
                class="alia"
                depth="3"
              >
                ({{ song.alia }})
              </n-text>
            </n-ellipsis>
          </div>
          <n-flex :size="4" :wrap="false" class="desc" align="center">
            <!-- 歌手 -->
            <template v-if="settingStore.showSongArtist">
              <div v-if="Array.isArray(song.artists)" class="artists">
                <n-text
                  v-for="ar in song.artists"
                  :key="ar.id"
                  class="ar"
                  @click="openJumpArtist(song.artists, ar.id, song.origin, ar.name)"
                >
                  {{ settingStore.hideBracketedContent ? removeBrackets(ar.name) : ar.name }}
                </n-text>
              </div>
              <div v-else-if="song.type === 'radio'" class="artists">
                <n-text class="ar"> 电台节目 </n-text>
              </div>
              <div
                v-else
                class="artists"
                @click="openJumpArtist(song.artists, undefined, song.origin)"
              >
                <n-text class="ar">
                  {{
                    settingStore.hideBracketedContent
                      ? removeBrackets(song.artists)
                      : song.artists || "未知艺术家"
                  }}
                </n-text>
              </div>
            </template>
          </n-flex>
        </n-flex>
      </div>
      <!-- 更新日期 -->
      <n-text v-if="song.type === 'radio' && !isSmallScreen" class="meta date" depth="3">
        {{ formatTimestamp(song.updateTime) }}
      </n-text>
      <!-- 播放量 -->
      <n-text v-if="song.type === 'radio' && !isSmallScreen" class="meta" depth="3">
        {{ formatNumber(song.playCount || 0) }}
      </n-text>
      <!-- 时长 -->
      <n-text v-if="!isSmallScreen && settingStore.showSongDuration" class="meta" depth="3">
        {{ msToTime(song.duration) }}
      </n-text>
      <!-- 大小 -->
      <n-text v-if="song.size && !hiddenSize && !isSmallScreen" class="meta size" depth="3">
        {{ formatFileSize(song.size) }}
      </n-text>
      <!-- 操作 -->
      <div
        v-if="song.type !== 'radio' && settingStore.showSongOperations"
        class="actions"
        @click.stop
        @dblclick.stop
      >
        <!-- 喜欢歌曲 -->
        <SvgIcon
          v-if="!isSmallScreen"
          :name="dataStore.isLikeSong(song.id) ? 'Favorite' : 'FavoriteBorder'"
          :size="20"
          @click.stop="toLikeSong(song, !dataStore.isLikeSong(song.id))"
          @delclick.stop
        />
        <!-- 移动端菜单 -->
        <SvgIcon v-else name="More" :size="20" @click.stop="emit('show-menu', $event)" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SongType } from "@/types/main";
import { useMusicStore, useDataStore, useSettingStore } from "@/stores";
import { formatNumber, formatFileSize } from "@/utils/helper";
import { openJumpArtist } from "@/utils/modal";
import { removeBrackets } from "@/utils/format";
import { toLikeSong } from "@/utils/auth";
import { formatTimestamp, msToTime } from "@/utils/time";
import { useMobile } from "@/composables/useMobile";

const props = defineProps<{
  // 歌曲
  song: SongType;
  // 序号
  index?: number;
  // 隐藏信息
  hiddenSize?: boolean;
}>();

const emit = defineEmits<{
  "show-menu": [event: MouseEvent];
}>();

const { isSmallScreen } = useMobile();
const dataStore = useDataStore();
const musicStore = useMusicStore();
const settingStore = useSettingStore();

// 歌曲数据
const song = toRef(props, "song");
</script>

<style lang="scss" scoped>
.song-card {
  height: 64px;
  cursor: pointer;
  .song-content {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    height: 100%;
    padding: 0 16px;
    border-bottom: 1px solid var(--divider-color);
    transition: background-color 0.2s var(--n-bezier);
    &:hover {
      background-color: rgba(var(--primary), 0.06);
    }
    &.play {
      background-color: rgba(var(--primary), 0.1);
    }
    &.play .name-text,
    &.play .track-index {
      color: var(--primary-hex);
    }
  }
  .track-index {
    width: 28px;
    flex-shrink: 0;
    font-size: 17px;
    font-weight: 500;
    text-align: center;
    color: var(--text-color-3);
    font-variant-numeric: tabular-nums;
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    padding: 0;
    .info {
      min-width: 0;
      .name {
        display: flex;
        flex-direction: row;
        align-items: center;
        line-height: normal;
        font-size: 15px;
      }
      .desc {
        min-width: 0;
        margin-top: 2px;
        font-size: 12px;
      }
      .artists {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        .ar {
          display: inline;
          transition: opacity 0.3s;
          opacity: 0.6;
          cursor: pointer;
          &::after {
            content: "/";
            margin: 0 4px;
          }
          &:last-child {
            &::after {
              display: none;
            }
          }
          &:hover {
            opacity: 0.8;
          }
        }
      }
    }
    .sort {
      margin-left: 6px;
      &::after {
        content: " )";
      }
      &::before {
        content: "( ";
      }
    }
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    .n-icon {
      color: var(--primary-hex);
      transition: transform 0.3s;
      cursor: pointer;
      &:hover {
        transform: scale(1.15);
      }
      &:active {
        transform: scale(1);
      }
    }
  }
  .meta {
    width: 50px;
    font-size: 12px;
    text-align: center;
    &.size {
      width: 60px;
    }
    &.date {
      width: 80px;
    }
  }
  &.header {
    border: none;
    background-color: transparent;
    .n-text {
      opacity: 0.6;
    }
    .title {
      position: relative;
      padding: 0 20px 0 0;
      &.has-sort {
        &::after {
          content: "";
          position: absolute;
          opacity: 0;
          top: 0;
          left: -8px;
          width: 100%;
          height: 100%;
          border-radius: 8px;
          background-color: rgba(var(--primary), 0.08);
          transition: opacity 0.3s;
        }
        &:hover {
          &::after {
            opacity: 1;
          }
        }
      }
    }
  }
}
</style>
