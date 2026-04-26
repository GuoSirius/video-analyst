import { d as defineStore, r as ref, c as computed, a as defineComponent, u as useI18n, o as onMounted, b as createElementBlock, e as createBaseVNode, t as toDisplayString, f as createTextVNode, g as createVNode, w as withCtx, h as unref, F as Fragment, i as renderList, j as createCommentVNode, k as resolveComponent, l as openBlock, n as normalizeClass, _ as _export_sfc } from "./index-oAoeczDA.js";
const useTaskStore = defineStore("tasks", () => {
  const tasks = ref([]);
  async function loadTasks() {
    if (window.electronAPI) {
      const loadedTasks = await window.electronAPI.getTasks();
      tasks.value = loadedTasks || [];
    }
  }
  async function addTask(file) {
    const newTask = {
      id: Date.now().toString(),
      fileName: file.name,
      filePath: file.path,
      fileSize: file.size,
      status: "pending",
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    if (window.electronAPI) {
      await window.electronAPI.addTask(newTask);
    }
    tasks.value.push(newTask);
    return newTask;
  }
  async function updateTask(taskId, updates) {
    if (window.electronAPI) {
      await window.electronAPI.updateTask(taskId, updates);
    }
    const index = tasks.value.findIndex((t) => t.id === taskId);
    if (index !== -1) {
      tasks.value[index] = { ...tasks.value[index], ...updates, updatedAt: Date.now() };
    }
  }
  async function processTask(taskId, method, llmConfigId) {
    if (window.electronAPI) {
      try {
        await updateTask(taskId, { status: "processing", progress: 0 });
        const result = await window.electronAPI.processTask(taskId, method, llmConfigId);
        await updateTask(taskId, { status: "completed", progress: 100, outputPath: result });
        return result;
      } catch (error) {
        await updateTask(taskId, { status: "failed", error: error.message });
        throw error;
      }
    }
  }
  const pendingTasks = computed(() => tasks.value.filter((t) => t.status === "pending"));
  const processingTasks = computed(() => tasks.value.filter((t) => t.status === "processing"));
  const completedTasks = computed(() => tasks.value.filter((t) => t.status === "completed"));
  const failedTasks = computed(() => tasks.value.filter((t) => t.status === "failed"));
  return {
    tasks,
    pendingTasks,
    processingTasks,
    completedTasks,
    failedTasks,
    loadTasks,
    addTask,
    updateTask,
    processTask
  };
});
const _hoisted_1 = { class: "home" };
const _hoisted_2 = { class: "stats-grid" };
const _hoisted_3 = { class: "stat-card" };
const _hoisted_4 = { class: "stat-info" };
const _hoisted_5 = { class: "stat-value" };
const _hoisted_6 = { class: "stat-card" };
const _hoisted_7 = { class: "stat-info" };
const _hoisted_8 = { class: "stat-value" };
const _hoisted_9 = { class: "stat-card" };
const _hoisted_10 = { class: "stat-info" };
const _hoisted_11 = { class: "stat-value" };
const _hoisted_12 = { class: "stat-card" };
const _hoisted_13 = { class: "stat-info" };
const _hoisted_14 = { class: "stat-value" };
const _hoisted_15 = { class: "content-grid" };
const _hoisted_16 = { class: "content-card config-section" };
const _hoisted_17 = { class: "config-form" };
const _hoisted_18 = { class: "form-item" };
const _hoisted_19 = { class: "form-item" };
const _hoisted_20 = { class: "form-item" };
const _hoisted_21 = { class: "slider-row" };
const _hoisted_22 = { class: "slider-value" };
const _hoisted_23 = { class: "form-item switch-item" };
const _hoisted_24 = { class: "config-actions" };
const _hoisted_25 = ["disabled"];
const _hoisted_26 = {
  key: 0,
  class: "tasks-section"
};
const _hoisted_27 = { class: "section-header" };
const _hoisted_28 = { class: "task-count" };
const _hoisted_29 = { class: "tasks-list" };
const _hoisted_30 = { class: "task-icon" };
const _hoisted_31 = {
  key: 0,
  class: "fa-solid fa-file-video"
};
const _hoisted_32 = {
  key: 1,
  class: "fa-solid fa-check"
};
const _hoisted_33 = { class: "task-info" };
const _hoisted_34 = { class: "task-name" };
const _hoisted_35 = { class: "task-size" };
const _hoisted_36 = { class: "task-status" };
const _hoisted_37 = {
  key: 1,
  class: "fa-solid fa-spinner fa-spin"
};
const _hoisted_38 = {
  key: 0,
  class: "task-progress"
};
const _hoisted_39 = { class: "task-actions" };
const _hoisted_40 = ["onClick"];
const _hoisted_41 = ["onClick"];
const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "Home",
  setup(__props) {
    const { t } = useI18n();
    const taskStore = useTaskStore();
    const includeSubfolder = ref(false);
    const recursionDepth = ref(3);
    const transcriptionMethod = ref("local");
    const selectedModel = ref("");
    async function selectFolder() {
      if (window.electronAPI) {
        const folderPath = await window.electronAPI.selectFolder();
        console.log("Selected folder:", folderPath);
      }
    }
    async function selectFiles() {
      if (window.electronAPI) {
        const filePaths = await window.electronAPI.selectFiles();
        console.log("Selected files:", filePaths);
      }
    }
    async function startProcessingTask(task) {
      try {
        await taskStore.processTask(task.id, transcriptionMethod.value, selectedModel.value);
      } catch (error) {
        console.error("Processing failed:", error);
      }
    }
    async function startProcessing() {
      const pendingTasks = taskStore.tasks.filter((t2) => t2.status === "pending");
      for (const task of pendingTasks) {
        await startProcessingTask(task);
      }
    }
    function resetTask(taskId) {
      taskStore.updateTask(taskId, { status: "pending", progress: 0 });
    }
    function getStatusText(status) {
      return t(`home.status.${status}`);
    }
    function getStatusIconClass(status) {
      switch (status) {
        case "pending":
          return "fa-clock";
        case "processing":
          return "fa-spin fa-spinner";
        case "completed":
          return "fa-check";
        case "failed":
          return "fa-exclamation-circle";
        default:
          return "fa-clock";
      }
    }
    const stats = computed(() => {
      const tasks = taskStore.tasks;
      return {
        total: tasks.length,
        pending: tasks.filter((t2) => t2.status === "pending").length,
        processing: tasks.filter((t2) => t2.status === "processing").length,
        completed: tasks.filter((t2) => t2.status === "completed").length,
        failed: tasks.filter((t2) => t2.status === "failed").length
      };
    });
    onMounted(async () => {
      await taskStore.loadTasks();
    });
    return (_ctx, _cache) => {
      const _component_el_radio_button = resolveComponent("el-radio-button");
      const _component_el_radio_group = resolveComponent("el-radio-group");
      const _component_el_option = resolveComponent("el-option");
      const _component_el_select = resolveComponent("el-select");
      const _component_el_slider = resolveComponent("el-slider");
      const _component_el_switch = resolveComponent("el-switch");
      const _component_el_tag = resolveComponent("el-tag");
      const _component_el_progress = resolveComponent("el-progress");
      return openBlock(), createElementBlock("div", _hoisted_1, [
        _cache[26] || (_cache[26] = createBaseVNode("div", { class: "page-header" }, [
          createBaseVNode("div", { class: "header-content" }, [
            createBaseVNode("h1", { class: "page-title" }, "视频分析"),
            createBaseVNode("p", { class: "page-subtitle" }, "选择视频文件，开始智能分析处理")
          ])
        ], -1)),
        createBaseVNode("div", _hoisted_2, [
          createBaseVNode("div", _hoisted_3, [
            _cache[5] || (_cache[5] = createBaseVNode("div", { class: "stat-icon total" }, [
              createBaseVNode("i", { class: "fa-solid fa-film" })
            ], -1)),
            createBaseVNode("div", _hoisted_4, [
              createBaseVNode("span", _hoisted_5, toDisplayString(stats.value.total), 1),
              _cache[4] || (_cache[4] = createBaseVNode("span", { class: "stat-label" }, "总任务", -1))
            ])
          ]),
          createBaseVNode("div", _hoisted_6, [
            _cache[7] || (_cache[7] = createBaseVNode("div", { class: "stat-icon pending" }, [
              createBaseVNode("i", { class: "fa-regular fa-clock" })
            ], -1)),
            createBaseVNode("div", _hoisted_7, [
              createBaseVNode("span", _hoisted_8, toDisplayString(stats.value.pending), 1),
              _cache[6] || (_cache[6] = createBaseVNode("span", { class: "stat-label" }, "待处理", -1))
            ])
          ]),
          createBaseVNode("div", _hoisted_9, [
            _cache[9] || (_cache[9] = createBaseVNode("div", { class: "stat-icon processing" }, [
              createBaseVNode("i", { class: "fa-solid fa-spinner" })
            ], -1)),
            createBaseVNode("div", _hoisted_10, [
              createBaseVNode("span", _hoisted_11, toDisplayString(stats.value.processing), 1),
              _cache[8] || (_cache[8] = createBaseVNode("span", { class: "stat-label" }, "处理中", -1))
            ])
          ]),
          createBaseVNode("div", _hoisted_12, [
            _cache[11] || (_cache[11] = createBaseVNode("div", { class: "stat-icon completed" }, [
              createBaseVNode("i", { class: "fa-solid fa-check-circle" })
            ], -1)),
            createBaseVNode("div", _hoisted_13, [
              createBaseVNode("span", _hoisted_14, toDisplayString(stats.value.completed), 1),
              _cache[10] || (_cache[10] = createBaseVNode("span", { class: "stat-label" }, "已完成", -1))
            ])
          ])
        ]),
        createBaseVNode("div", _hoisted_15, [
          createBaseVNode("div", { class: "content-card file-upload-section" }, [
            _cache[14] || (_cache[14] = createBaseVNode("div", { class: "card-header" }, [
              createBaseVNode("div", { class: "card-icon" }, [
                createBaseVNode("i", { class: "fa-solid fa-cloud-arrow-up" })
              ]),
              createBaseVNode("h3", { class: "card-title" }, "选择视频文件")
            ], -1)),
            createBaseVNode("div", {
              class: "upload-area",
              onClick: selectFiles
            }, [..._cache[12] || (_cache[12] = [
              createBaseVNode("div", { class: "upload-icon" }, [
                createBaseVNode("i", { class: "fa-solid fa-video" })
              ], -1),
              createBaseVNode("p", { class: "upload-text" }, "点击选择视频文件", -1),
              createBaseVNode("p", { class: "upload-hint" }, "支持 MP4, AVI, MOV, MKV 等格式", -1)
            ])]),
            createBaseVNode("div", { class: "folder-select" }, [
              createBaseVNode("button", {
                class: "folder-btn",
                onClick: selectFolder
              }, [..._cache[13] || (_cache[13] = [
                createBaseVNode("i", { class: "fa-solid fa-folder-open" }, null, -1),
                createTextVNode(" 选择文件夹 ", -1)
              ])])
            ])
          ]),
          createBaseVNode("div", _hoisted_16, [
            _cache[22] || (_cache[22] = createBaseVNode("div", { class: "card-header" }, [
              createBaseVNode("div", { class: "card-icon" }, [
                createBaseVNode("i", { class: "fa-solid fa-sliders" })
              ]),
              createBaseVNode("h3", { class: "card-title" }, "处理配置")
            ], -1)),
            createBaseVNode("div", _hoisted_17, [
              createBaseVNode("div", _hoisted_18, [
                _cache[17] || (_cache[17] = createBaseVNode("label", null, "转录方式", -1)),
                createVNode(_component_el_radio_group, {
                  modelValue: transcriptionMethod.value,
                  "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => transcriptionMethod.value = $event),
                  class: "method-group"
                }, {
                  default: withCtx(() => [
                    createVNode(_component_el_radio_button, { value: "local" }, {
                      default: withCtx(() => [..._cache[15] || (_cache[15] = [
                        createBaseVNode("span", { class: "radio-label" }, "本地处理", -1),
                        createBaseVNode("span", { class: "radio-desc" }, "使用本地模型", -1)
                      ])]),
                      _: 1
                    }),
                    createVNode(_component_el_radio_button, { value: "cloud" }, {
                      default: withCtx(() => [..._cache[16] || (_cache[16] = [
                        createBaseVNode("span", { class: "radio-label" }, "云端处理", -1),
                        createBaseVNode("span", { class: "radio-desc" }, "调用云端API", -1)
                      ])]),
                      _: 1
                    })
                  ]),
                  _: 1
                }, 8, ["modelValue"])
              ]),
              createBaseVNode("div", _hoisted_19, [
                _cache[18] || (_cache[18] = createBaseVNode("label", null, "选择模型", -1)),
                createVNode(_component_el_select, {
                  modelValue: selectedModel.value,
                  "onUpdate:modelValue": _cache[1] || (_cache[1] = ($event) => selectedModel.value = $event),
                  placeholder: "请选择模型",
                  class: "model-select"
                }, {
                  default: withCtx(() => [
                    createVNode(_component_el_option, {
                      label: "Local Whisper",
                      value: "local-whisper"
                    }),
                    createVNode(_component_el_option, {
                      label: "OpenAI Whisper API",
                      value: "openai-whisper"
                    })
                  ]),
                  _: 1
                }, 8, ["modelValue"])
              ]),
              createBaseVNode("div", _hoisted_20, [
                _cache[19] || (_cache[19] = createBaseVNode("label", null, "递归深度", -1)),
                createBaseVNode("div", _hoisted_21, [
                  createVNode(_component_el_slider, {
                    modelValue: recursionDepth.value,
                    "onUpdate:modelValue": _cache[2] || (_cache[2] = ($event) => recursionDepth.value = $event),
                    min: 1,
                    max: 10,
                    "show-tooltip": false,
                    class: "depth-slider"
                  }, null, 8, ["modelValue"]),
                  createBaseVNode("span", _hoisted_22, toDisplayString(recursionDepth.value), 1)
                ])
              ]),
              createBaseVNode("div", _hoisted_23, [
                _cache[20] || (_cache[20] = createBaseVNode("label", null, "包含子文件夹", -1)),
                createVNode(_component_el_switch, {
                  modelValue: includeSubfolder.value,
                  "onUpdate:modelValue": _cache[3] || (_cache[3] = ($event) => includeSubfolder.value = $event)
                }, null, 8, ["modelValue"])
              ])
            ]),
            createBaseVNode("div", _hoisted_24, [
              createBaseVNode("button", {
                class: "start-btn",
                onClick: startProcessing,
                disabled: stats.value.pending === 0
              }, [..._cache[21] || (_cache[21] = [
                createBaseVNode("i", { class: "fa-solid fa-play" }, null, -1),
                createTextVNode(" 开始处理 ", -1)
              ])], 8, _hoisted_25)
            ])
          ])
        ]),
        unref(taskStore).tasks.length > 0 ? (openBlock(), createElementBlock("div", _hoisted_26, [
          createBaseVNode("div", _hoisted_27, [
            _cache[23] || (_cache[23] = createBaseVNode("h3", { class: "section-title" }, "任务列表", -1)),
            createBaseVNode("span", _hoisted_28, toDisplayString(unref(taskStore).tasks.length) + " 个任务", 1)
          ]),
          createBaseVNode("div", _hoisted_29, [
            (openBlock(true), createElementBlock(Fragment, null, renderList(unref(taskStore).tasks, (task) => {
              return openBlock(), createElementBlock("div", {
                key: task.id,
                class: normalizeClass(["task-item", task.status])
              }, [
                createBaseVNode("div", _hoisted_30, [
                  task.status !== "completed" ? (openBlock(), createElementBlock("i", _hoisted_31)) : (openBlock(), createElementBlock("i", _hoisted_32))
                ]),
                createBaseVNode("div", _hoisted_33, [
                  createBaseVNode("span", _hoisted_34, toDisplayString(task.fileName), 1),
                  createBaseVNode("span", _hoisted_35, toDisplayString(task.fileSize || "未知大小"), 1)
                ]),
                createBaseVNode("div", _hoisted_36, [
                  createVNode(_component_el_tag, {
                    type: task.status === "completed" ? "success" : task.status === "failed" ? "danger" : task.status === "processing" ? "warning" : "info",
                    size: "small"
                  }, {
                    default: withCtx(() => [
                      task.status !== "processing" ? (openBlock(), createElementBlock("i", {
                        key: 0,
                        class: normalizeClass(["fa-solid", getStatusIconClass(task.status)])
                      }, null, 2)) : (openBlock(), createElementBlock("i", _hoisted_37)),
                      createTextVNode(" " + toDisplayString(getStatusText(task.status)), 1)
                    ]),
                    _: 2
                  }, 1032, ["type"])
                ]),
                task.status === "processing" ? (openBlock(), createElementBlock("div", _hoisted_38, [
                  createVNode(_component_el_progress, {
                    percentage: task.progress,
                    "stroke-width": 6
                  }, null, 8, ["percentage"])
                ])) : createCommentVNode("", true),
                createBaseVNode("div", _hoisted_39, [
                  task.status === "pending" ? (openBlock(), createElementBlock("button", {
                    key: 0,
                    class: "action-btn play-btn",
                    onClick: ($event) => startProcessingTask(task)
                  }, [..._cache[24] || (_cache[24] = [
                    createBaseVNode("i", { class: "fa-solid fa-play" }, null, -1)
                  ])], 8, _hoisted_40)) : createCommentVNode("", true),
                  createBaseVNode("button", {
                    class: "action-btn reset-btn",
                    onClick: ($event) => resetTask(task.id)
                  }, [..._cache[25] || (_cache[25] = [
                    createBaseVNode("i", { class: "fa-solid fa-rotate-right" }, null, -1)
                  ])], 8, _hoisted_41)
                ])
              ], 2);
            }), 128))
          ])
        ])) : createCommentVNode("", true)
      ]);
    };
  }
});
const Home = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-f31787a6"]]);
export {
  Home as default
};
