<template>
  <div class="webdav-login">
    <div class="header">
      <img class="avatar" :src="avatarPlaceholder" alt="Lyra" />
      <n-text class="title">WebDAV 登录</n-text>
      <n-text class="subtitle" :depth="3">
        配置 WebDAV 服务器，与 Lyra 手机端共用同一份账号数据
      </n-text>
    </div>
    <n-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-placement="top"
      size="large"
      @submit.prevent="handleLogin"
    >
      <n-form-item label="服务器 URL" path="serverUrl">
        <n-input v-model:value="form.serverUrl" placeholder="https://example.com/dav">
          <template #prefix>
            <SvgIcon name="Cloud" :depth="3" />
          </template>
        </n-input>
      </n-form-item>
      <n-form-item label="用户名" path="username">
        <n-input v-model:value="form.username" placeholder="your-username">
          <template #prefix>
            <SvgIcon name="Person" :depth="3" />
          </template>
        </n-input>
      </n-form-item>
      <n-form-item label="密码" path="password">
        <n-input
          v-model:value="form.password"
          type="password"
          show-password-on="click"
          placeholder="请输入密码"
        >
          <template #prefix>
            <SvgIcon name="Lock" :depth="3" />
          </template>
        </n-input>
      </n-form-item>
      <n-form-item label="初始路径" path="basePath">
        <n-input v-model:value="form.basePath" placeholder="backup/lyra">
          <template #prefix>
            <SvgIcon name="Folder" :depth="3" />
          </template>
        </n-input>
      </n-form-item>
      <n-alert v-if="errorMessage" type="error" :bordered="false" class="error">
        {{ errorMessage }}
      </n-alert>
      <n-button
        block
        type="primary"
        strong
        attr-type="submit"
        :loading="accountStore.loading"
        class="submit"
      >
        验证并保存
      </n-button>
    </n-form>
    <n-text class="hint" :depth="3">
      配置仅保存在本机，账号数据将以 Lyra-sync.json 保存到上述目录。
    </n-text>
  </div>
</template>

<script setup lang="ts">
import type { FormInst, FormRules } from "naive-ui";
import { useAccountStore } from "@/stores";
import avatarPlaceholder from "@/assets/lyra-avatar.png";

const emit = defineEmits<{
  (e: "close"): void;
  (e: "success"): void;
}>();

const accountStore = useAccountStore();
const formRef = ref<FormInst | null>(null);
const errorMessage = ref("");

const form = reactive({
  serverUrl: accountStore.serverUrl,
  username: accountStore.username,
  password: "",
  basePath: accountStore.basePath,
});

const rules: FormRules = {
  serverUrl: [
    { required: true, message: "请输入服务器 URL", trigger: ["blur", "input"] },
    {
      pattern: /^https?:\/\/.+/i,
      message: "服务器 URL 需要以 http:// 或 https:// 开头",
      trigger: ["blur", "input"],
    },
  ],
  username: [{ required: true, message: "请输入用户名", trigger: ["blur", "input"] }],
  password: [{ required: true, message: "请输入密码", trigger: ["blur", "input"] }],
};

// 校验并保存
const handleLogin = async () => {
  if (accountStore.loading) return;
  errorMessage.value = "";
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  const result = await accountStore.login({
    serverUrl: form.serverUrl.trim(),
    username: form.username.trim(),
    password: form.password,
    basePath: form.basePath.trim(),
  });
  if (result.success) {
    window.$message.success("WebDAV 配置成功");
    emit("success");
  } else {
    errorMessage.value = result.error || "WebDAV 配置失败";
  }
};

// 进入时读取已有配置
onMounted(async () => {
  await accountStore.load();
  form.serverUrl = accountStore.serverUrl;
  form.username = accountStore.username;
  form.basePath = accountStore.basePath;
});
</script>

<style lang="scss" scoped>
.webdav-login {
  width: 100%;
  .header {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 18px;
    .avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      margin-bottom: 12px;
    }
    .title {
      font-size: 18px;
      font-weight: 600;
    }
    .subtitle {
      margin-top: 6px;
      font-size: 12px;
      text-align: center;
    }
  }
  .error {
    margin-bottom: 12px;
  }
  .submit {
    margin-top: 4px;
    border-radius: 8px;
  }
  .hint {
    display: block;
    margin-top: 12px;
    font-size: 12px;
    text-align: center;
  }
}
</style>
