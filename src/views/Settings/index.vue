<template>
  <div class="settings-view">
    <div class="settings-shell">
      <MainSetting
        :key="`${activeTab}-${scrollTo || ''}`"
        :type="activeTab"
        :scroll-to="scrollTo"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SettingType } from "@/types/main";
import MainSetting from "@/components/Setting/MainSetting.vue";

const route = useRoute();

const activeTab = computed<SettingType>(() => (route.query.tab as SettingType) || "account");
const scrollTo = computed(() => (route.query.scrollTo as string) || undefined);
</script>

<style scoped>
.settings-view {
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: 10px 0 24px;
}
.settings-shell {
  width: 100%;
}
</style>

<style lang="scss">
.settings-view .setting {
  height: calc(100vh - 250px);
  min-height: 480px;
  border-radius: 24px;
  border: 1px solid rgba(var(--divider), 0.6);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.08);
  background-color: var(--background-hex);
}
.settings-view .set-left {
  border-radius: 24px 0 0 24px;
}
.settings-view .set-right {
  border-radius: 0 24px 24px 0;
}
@media (max-width: 768px) {
  .settings-view .setting {
    height: calc(100vh - 230px);
    min-height: 420px;
    border-radius: 18px;
  }
  .settings-view .set-left {
    border-radius: 18px 0 0 18px;
  }
  .settings-view .set-right {
    border-radius: 0 18px 18px 0;
  }
}
</style>
