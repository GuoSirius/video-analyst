import { a as defineComponent, u as useI18n, m as useAppStore, o as onMounted, b as createElementBlock, e as createBaseVNode, p as createStaticVNode, F as Fragment, i as renderList, h as unref, f as createTextVNode, g as createVNode, w as withCtx, t as toDisplayString, r as ref, q as reactive, k as resolveComponent, l as openBlock, n as normalizeClass, _ as _export_sfc } from "./index-oAoeczDA.js";
const _hoisted_1 = { class: "settings" };
const _hoisted_2 = { class: "settings-grid" };
const _hoisted_3 = { class: "settings-card" };
const _hoisted_4 = { class: "settings-list" };
const _hoisted_5 = { class: "setting-item" };
const _hoisted_6 = { class: "setting-control" };
const _hoisted_7 = { class: "lang-selector" };
const _hoisted_8 = ["onClick"];
const _hoisted_9 = { class: "lang-text" };
const _hoisted_10 = { class: "setting-item" };
const _hoisted_11 = { class: "setting-info" };
const _hoisted_12 = { class: "setting-icon theme" };
const _hoisted_13 = {
  key: 0,
  class: "fa-solid fa-moon"
};
const _hoisted_14 = {
  key: 1,
  class: "fa-solid fa-sun"
};
const _hoisted_15 = { class: "setting-control" };
const _hoisted_16 = { class: "theme-selector" };
const _hoisted_17 = ["onClick"];
const _hoisted_18 = { class: "settings-card llm-card" };
const _hoisted_19 = {
  key: 0,
  class: "llm-list"
};
const _hoisted_20 = { class: "llm-logo" };
const _hoisted_21 = { class: "llm-info" };
const _hoisted_22 = { class: "llm-name" };
const _hoisted_23 = { class: "llm-provider" };
const _hoisted_24 = { class: "llm-model" };
const _hoisted_25 = { class: "model-value" };
const _hoisted_26 = { class: "llm-actions" };
const _hoisted_27 = ["onClick"];
const _hoisted_28 = ["onClick"];
const _hoisted_29 = {
  key: 1,
  class: "empty-state"
};
const _hoisted_30 = { class: "temp-slider" };
const _hoisted_31 = { class: "temp-labels" };
const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "Settings",
  setup(__props) {
    const { t, locale } = useI18n();
    const appStore = useAppStore();
    const languageOptions = [
      { value: "zh-CN", label: "简体中文", icon: "fa-solid fa-language" },
      { value: "en-US", label: "English", icon: "fa-solid fa-language" }
    ];
    const themeOptions = [
      { value: "dark", label: "深色", icon: "fa-solid fa-moon" },
      { value: "light", label: "浅色", icon: "fa-solid fa-sun" },
      { value: "auto", label: "跟随系统", icon: "fa-solid fa-desktop" }
    ];
    const providerOptions = [
      { value: "openai", label: "OpenAI", logo: "fa-brands fa-openai" },
      { value: "wenxin", label: "文心一言", logo: "fa-solid fa-brain" },
      { value: "local-whisper", label: "Local Whisper", logo: "fa-solid fa-microphone-lines" },
      { value: "custom", label: "自定义", logo: "fa-solid fa-gear" }
    ];
    const llmConfigs = ref([]);
    const dialogVisible = ref(false);
    const isEditing = ref(false);
    const currentConfig = reactive({
      id: "",
      name: "",
      provider: "openai",
      apiKey: "",
      apiUrl: "",
      modelName: "",
      temperature: 0.3
    });
    function openAddDialog() {
      isEditing.value = false;
      Object.assign(currentConfig, {
        id: Date.now().toString(),
        name: "",
        provider: "openai",
        apiKey: "",
        apiUrl: "",
        modelName: "",
        temperature: 0.3
      });
      dialogVisible.value = true;
    }
    function openEditDialog(config) {
      isEditing.value = true;
      Object.assign(currentConfig, { ...config });
      dialogVisible.value = true;
    }
    async function saveConfig() {
      if (window.electronAPI) {
        await window.electronAPI.saveLLMConfig({ ...currentConfig });
        await loadConfigs();
      }
      dialogVisible.value = false;
    }
    async function deleteConfig(id) {
      if (window.electronAPI) {
        await window.electronAPI.deleteLLMConfig(id);
        await loadConfigs();
      }
    }
    async function loadConfigs() {
      if (window.electronAPI) {
        const configs = await window.electronAPI.getLLMConfigs();
        llmConfigs.value = configs || [];
      }
    }
    function onLanguageChange(value) {
      locale.value = value;
      appStore.setLanguage(value);
    }
    function onThemeChange(value) {
      appStore.setTheme(value);
    }
    function getProviderInfo(provider) {
      return providerOptions.find((p) => p.value === provider) || providerOptions[3];
    }
    onMounted(() => {
      loadConfigs();
    });
    return (_ctx, _cache) => {
      const _component_el_input = resolveComponent("el-input");
      const _component_el_form_item = resolveComponent("el-form-item");
      const _component_el_option = resolveComponent("el-option");
      const _component_el_select = resolveComponent("el-select");
      const _component_el_slider = resolveComponent("el-slider");
      const _component_el_form = resolveComponent("el-form");
      const _component_el_button = resolveComponent("el-button");
      const _component_el_dialog = resolveComponent("el-dialog");
      return openBlock(), createElementBlock("div", _hoisted_1, [
        _cache[21] || (_cache[21] = createBaseVNode("div", { class: "page-header" }, [
          createBaseVNode("div", { class: "header-content" }, [
            createBaseVNode("h1", { class: "page-title" }, "设置"),
            createBaseVNode("p", { class: "page-subtitle" }, "个性化配置，应用偏好设置")
          ])
        ], -1)),
        createBaseVNode("div", _hoisted_2, [
          createBaseVNode("div", _hoisted_3, [
            _cache[10] || (_cache[10] = createBaseVNode("div", { class: "card-header" }, [
              createBaseVNode("div", { class: "card-icon" }, [
                createBaseVNode("i", { class: "fa-solid fa-sliders" })
              ]),
              createBaseVNode("h3", { class: "card-title" }, "常规设置")
            ], -1)),
            createBaseVNode("div", _hoisted_4, [
              createBaseVNode("div", _hoisted_5, [
                _cache[8] || (_cache[8] = createStaticVNode('<div class="setting-info" data-v-3d61e6dc><div class="setting-icon lang" data-v-3d61e6dc><i class="fa-solid fa-language" data-v-3d61e6dc></i></div><div class="setting-text" data-v-3d61e6dc><span class="setting-label" data-v-3d61e6dc>语言</span><span class="setting-desc" data-v-3d61e6dc>选择界面显示语言</span></div></div>', 1)),
                createBaseVNode("div", _hoisted_6, [
                  createBaseVNode("div", _hoisted_7, [
                    (openBlock(), createElementBlock(Fragment, null, renderList(languageOptions, (option) => {
                      return createBaseVNode("button", {
                        key: option.value,
                        class: normalizeClass(["lang-option", { active: unref(locale) === option.value }]),
                        onClick: ($event) => onLanguageChange(option.value)
                      }, [
                        createBaseVNode("i", {
                          class: normalizeClass(option.icon)
                        }, null, 2),
                        createBaseVNode("span", _hoisted_9, toDisplayString(option.label), 1)
                      ], 10, _hoisted_8);
                    }), 64))
                  ])
                ])
              ]),
              createBaseVNode("div", _hoisted_10, [
                createBaseVNode("div", _hoisted_11, [
                  createBaseVNode("div", _hoisted_12, [
                    unref(appStore).isDark ? (openBlock(), createElementBlock("i", _hoisted_13)) : (openBlock(), createElementBlock("i", _hoisted_14))
                  ]),
                  _cache[9] || (_cache[9] = createBaseVNode("div", { class: "setting-text" }, [
                    createBaseVNode("span", { class: "setting-label" }, "主题"),
                    createBaseVNode("span", { class: "setting-desc" }, "选择应用外观主题")
                  ], -1))
                ]),
                createBaseVNode("div", _hoisted_15, [
                  createBaseVNode("div", _hoisted_16, [
                    (openBlock(), createElementBlock(Fragment, null, renderList(themeOptions, (option) => {
                      return createBaseVNode("button", {
                        key: option.value,
                        class: normalizeClass(["theme-option", { active: unref(appStore).theme === option.value }]),
                        onClick: ($event) => onThemeChange(option.value)
                      }, [
                        createBaseVNode("i", {
                          class: normalizeClass(option.icon)
                        }, null, 2),
                        createBaseVNode("span", null, toDisplayString(option.label), 1)
                      ], 10, _hoisted_17);
                    }), 64))
                  ])
                ])
              ])
            ])
          ]),
          createBaseVNode("div", _hoisted_18, [
            createBaseVNode("div", { class: "card-header" }, [
              _cache[12] || (_cache[12] = createBaseVNode("div", { class: "card-icon" }, [
                createBaseVNode("i", { class: "fa-solid fa-robot" })
              ], -1)),
              _cache[13] || (_cache[13] = createBaseVNode("h3", { class: "card-title" }, "大模型配置", -1)),
              createBaseVNode("button", {
                class: "add-btn",
                onClick: openAddDialog
              }, [..._cache[11] || (_cache[11] = [
                createBaseVNode("i", { class: "fa-solid fa-plus" }, null, -1),
                createTextVNode(" 添加配置 ", -1)
              ])])
            ]),
            llmConfigs.value.length > 0 ? (openBlock(), createElementBlock("div", _hoisted_19, [
              (openBlock(true), createElementBlock(Fragment, null, renderList(llmConfigs.value, (config) => {
                return openBlock(), createElementBlock("div", {
                  key: config.id,
                  class: "llm-item"
                }, [
                  createBaseVNode("div", _hoisted_20, [
                    createBaseVNode("i", {
                      class: normalizeClass(getProviderInfo(config.provider).logo)
                    }, null, 2)
                  ]),
                  createBaseVNode("div", _hoisted_21, [
                    createBaseVNode("span", _hoisted_22, toDisplayString(config.name), 1),
                    createBaseVNode("span", _hoisted_23, toDisplayString(getProviderInfo(config.provider).label), 1)
                  ]),
                  createBaseVNode("div", _hoisted_24, [
                    _cache[14] || (_cache[14] = createBaseVNode("span", { class: "model-label" }, "模型", -1)),
                    createBaseVNode("span", _hoisted_25, toDisplayString(config.modelName || "未设置"), 1)
                  ]),
                  createBaseVNode("div", _hoisted_26, [
                    createBaseVNode("button", {
                      class: "action-btn edit-btn",
                      onClick: ($event) => openEditDialog(config)
                    }, [..._cache[15] || (_cache[15] = [
                      createBaseVNode("i", { class: "fa-solid fa-pen" }, null, -1)
                    ])], 8, _hoisted_27),
                    createBaseVNode("button", {
                      class: "action-btn delete-btn",
                      onClick: ($event) => deleteConfig(config.id)
                    }, [..._cache[16] || (_cache[16] = [
                      createBaseVNode("i", { class: "fa-solid fa-trash" }, null, -1)
                    ])], 8, _hoisted_28)
                  ])
                ]);
              }), 128))
            ])) : (openBlock(), createElementBlock("div", _hoisted_29, [..._cache[17] || (_cache[17] = [
              createBaseVNode("div", { class: "empty-icon" }, [
                createBaseVNode("i", { class: "fa-regular fa-circle-check" })
              ], -1),
              createBaseVNode("p", { class: "empty-text" }, "暂无大模型配置", -1),
              createBaseVNode("p", { class: "empty-hint" }, "点击上方按钮添加新的配置", -1)
            ])]))
          ])
        ]),
        createVNode(_component_el_dialog, {
          modelValue: dialogVisible.value,
          "onUpdate:modelValue": _cache[7] || (_cache[7] = ($event) => dialogVisible.value = $event),
          title: isEditing.value ? "编辑配置" : "添加配置",
          width: "520px",
          class: "config-dialog"
        }, {
          footer: withCtx(() => [
            createVNode(_component_el_button, {
              onClick: _cache[6] || (_cache[6] = ($event) => dialogVisible.value = false),
              class: "cancel-btn"
            }, {
              default: withCtx(() => [..._cache[20] || (_cache[20] = [
                createTextVNode("取消", -1)
              ])]),
              _: 1
            }),
            createVNode(_component_el_button, {
              type: "primary",
              onClick: saveConfig,
              class: "save-btn"
            }, {
              default: withCtx(() => [
                createTextVNode(toDisplayString(isEditing.value ? "保存修改" : "添加配置"), 1)
              ]),
              _: 1
            })
          ]),
          default: withCtx(() => [
            createVNode(_component_el_form, {
              "label-position": "top",
              class: "config-form"
            }, {
              default: withCtx(() => [
                createVNode(_component_el_form_item, { label: "配置名称" }, {
                  default: withCtx(() => [
                    createVNode(_component_el_input, {
                      modelValue: currentConfig.name,
                      "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => currentConfig.name = $event),
                      placeholder: "例如：我的 Whisper"
                    }, null, 8, ["modelValue"])
                  ]),
                  _: 1
                }),
                createVNode(_component_el_form_item, { label: "服务提供商" }, {
                  default: withCtx(() => [
                    createVNode(_component_el_select, {
                      modelValue: currentConfig.provider,
                      "onUpdate:modelValue": _cache[1] || (_cache[1] = ($event) => currentConfig.provider = $event),
                      placeholder: "选择提供商",
                      class: "provider-select"
                    }, {
                      default: withCtx(() => [
                        (openBlock(), createElementBlock(Fragment, null, renderList(providerOptions, (option) => {
                          return createVNode(_component_el_option, {
                            key: option.value,
                            label: option.label,
                            value: option.value
                          }, {
                            default: withCtx(() => [
                              createBaseVNode("span", null, toDisplayString(option.logo) + " " + toDisplayString(option.label), 1)
                            ]),
                            _: 2
                          }, 1032, ["label", "value"]);
                        }), 64))
                      ]),
                      _: 1
                    }, 8, ["modelValue"])
                  ]),
                  _: 1
                }),
                createVNode(_component_el_form_item, { label: "API Key" }, {
                  default: withCtx(() => [
                    createVNode(_component_el_input, {
                      modelValue: currentConfig.apiKey,
                      "onUpdate:modelValue": _cache[2] || (_cache[2] = ($event) => currentConfig.apiKey = $event),
                      type: "password",
                      "show-password": "",
                      placeholder: "输入 API Key"
                    }, null, 8, ["modelValue"])
                  ]),
                  _: 1
                }),
                createVNode(_component_el_form_item, { label: "API 地址" }, {
                  default: withCtx(() => [
                    createVNode(_component_el_input, {
                      modelValue: currentConfig.apiUrl,
                      "onUpdate:modelValue": _cache[3] || (_cache[3] = ($event) => currentConfig.apiUrl = $event),
                      placeholder: "输入 API 地址（可选）"
                    }, null, 8, ["modelValue"])
                  ]),
                  _: 1
                }),
                createVNode(_component_el_form_item, { label: "模型名称" }, {
                  default: withCtx(() => [
                    createVNode(_component_el_input, {
                      modelValue: currentConfig.modelName,
                      "onUpdate:modelValue": _cache[4] || (_cache[4] = ($event) => currentConfig.modelName = $event),
                      placeholder: "例如：gpt-3.5-turbo"
                    }, null, 8, ["modelValue"])
                  ]),
                  _: 1
                }),
                createVNode(_component_el_form_item, { label: "温度参数" }, {
                  default: withCtx(() => [
                    createBaseVNode("div", _hoisted_30, [
                      createVNode(_component_el_slider, {
                        modelValue: currentConfig.temperature,
                        "onUpdate:modelValue": _cache[5] || (_cache[5] = ($event) => currentConfig.temperature = $event),
                        min: 0,
                        max: 1,
                        step: 0.1,
                        "show-tooltip": true
                      }, null, 8, ["modelValue"]),
                      createBaseVNode("div", _hoisted_31, [
                        _cache[18] || (_cache[18] = createBaseVNode("span", null, "精确", -1)),
                        createBaseVNode("span", null, toDisplayString(currentConfig.temperature), 1),
                        _cache[19] || (_cache[19] = createBaseVNode("span", null, "创意", -1))
                      ])
                    ])
                  ]),
                  _: 1
                })
              ]),
              _: 1
            })
          ]),
          _: 1
        }, 8, ["modelValue", "title"])
      ]);
    };
  }
});
const Settings = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-3d61e6dc"]]);
export {
  Settings as default
};
