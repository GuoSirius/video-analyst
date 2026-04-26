import { contextBridge, ipcRenderer } from "electron";
console.log("[Preload] Preload script loaded");
contextBridge.exposeInMainWorld("electronAPI", {
  // 窗口操作
  windowMinimize: () => ipcRenderer.send("window-minimize"),
  windowToggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
  windowClose: () => ipcRenderer.send("window-close"),
  windowToggleFullscreen: () => ipcRenderer.send("window-toggle-fullscreen"),
  // 窗口状态
  windowSetAlwaysOnTop: (onTop, level) => ipcRenderer.invoke("window-set-always-on-top", onTop, level),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  // 创建新窗口
  windowCreate: (options) => ipcRenderer.invoke("window-create", options),
  // 窗口最大化状态变化监听
  onWindowMaximize: (callback) => {
    ipcRenderer.on("window-maximize", callback);
    return () => ipcRenderer.removeListener("window-maximize", callback);
  },
  onWindowUnmaximize: (callback) => {
    ipcRenderer.on("window-unmaximize", callback);
    return () => ipcRenderer.removeListener("window-unmaximize", callback);
  },
  // 文件选择
  selectFiles: () => ipcRenderer.invoke("dialog:selectFiles"),
  selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
  // 任务管理
  getTasks: () => ipcRenderer.invoke("task:getTasks"),
  addTask: (task) => ipcRenderer.invoke("task:addTask", task),
  updateTask: (taskId, updates) => ipcRenderer.invoke("task:updateTask", taskId, updates),
  processTask: (taskId, method, llmConfigId) => ipcRenderer.invoke("task:process", taskId, method, llmConfigId),
  // LLM 配置管理
  getLLMConfigs: () => ipcRenderer.invoke("llm:getConfigs"),
  saveLLMConfig: (config) => ipcRenderer.invoke("llm:saveConfig", config),
  deleteLLMConfig: (id) => ipcRenderer.invoke("llm:deleteConfig", id),
  // 任务进度监听
  onTaskProgress: (callback) => {
    ipcRenderer.on("task:progress", (event, taskId, progress) => callback(taskId, progress));
    return () => ipcRenderer.removeListener("task:progress", callback);
  }
});
