// ==UserScript==
// @name         自动提取key
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  优化版自动化工具，集成以下功能：
// @              1. 在 console.cloud.google.com 自动生成指定数量的项目；
// @              2. 在项目生成后跳转至 aistudio.google.com/apikey 创建API密钥；
// @              3. 在 aistudio 页面提取已有API密钥。
// @              优化：获取密钥后立即关闭弹窗以提高效率；UI改为单图标按钮，包含指向GitHub的超链接。
// @author       fish2018 https://github.com/fish2018/
// @match        *://*.console.cloud.google.com/*
// @match        *://*.aistudio.google.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /**
     * 配置中心
     */
    const CONFIG = {
        common: {
            debugMode: false,
            crossDomainFlag: 'projectsGenerated',
        },
        projectGeneration: {
            desiredProjectCount: 5,
            intervalBetweenTries: 5000,
            maxRefreshAttempts: 5,
            refreshAttemptCounter: 'autoRefreshTracker',
            delayAfterButtonClick: 1000, // 减少延迟
            delayAfterProjectSelection: 1500, // 减少延迟
            delayBeforeConfirmation: 2000, // 减少延迟
        },
        keyGeneration: {
            keysPerProjectGoal: 1,
            keyGenerationTimeout: 20000, // 减少超时时间
            intervalBetweenTries: 2000, // 减少间隔
            intervalBetweenProjects: 3000, // 减少间隔
            dialogClosureTimeout: 3000, // 减少弹窗关闭超时
            delayAfterProjectSelection: 2000, // 减少延迟
            delayAfterButtonClick: 300, // 减少延迟
            delayBeforeOptionSelection: 1500, // 减少延迟
        },
        keyExtraction: {
            keyRevealTimeout: 20000, // 减少超时时间
            intervalBetweenLinks: 1000, // 减少间隔
            dialogClosureTimeout: 3000, // 减少弹窗关闭超时
            delayAfterScroll: 300, // 减少延迟
            delayAfterClick: 400, // 减少延迟
            delayAfterDialogClose: 1000, // 减少延迟
        },
        selectors: {
            projectGeneration: {
                projectSelectorButton: 'button.mdc-button.mat-mdc-button span.cfc-switcher-button-label-text',
                newProjectButton: 'button.purview-picker-create-project-button',
                confirmCreateButton: 'button.projtest-create-form-submit',
                quotaButton: 'a#p6ntest-quota-submit-button',
                quotaMessages: 'mat-dialog-content p, mat-dialog-content div, mat-dialog-container p, mat-dialog-container div',
            },
            keyGeneration: {
                primaryCreateButton: "button.create-api-key-button",
                modalDialog: "mat-dialog-content",
                projectQueryInput: "input#project-name-input",
                projectChoice: "mat-option.mat-mdc-option",
                projectNameInOption: ".gmat-body-medium",
                modalCreateButton: "mat-dialog-content button.create-api-key-button",
                keyDisplayElement: "div.apikey-text",
            },
            keyExtraction: {
                projectEntry: "project-table div[role='rowgroup'].table-body > div[role='row'].table-row",
                projectTitle: "div[role='cell'].project-cell > div:first-child",
                shortenedKeyLink: "div[role='cell'].project-cell + div[role='cell'].key-cell a.apikey-link",
                completeKeyDisplay: "div.apikey-text",
                hideKeyButton: "button[aria-label='关闭']",
            },
            dialog: {
                container: "mat-dialog-container",
                closeButtons: [
                    'button[aria-label="Close dialog"]',
                    'button[aria-label="关闭"]',
                    'mat-dialog-actions button:nth-child(1)',
                    'button.cancel-button',
                    'button:contains("Cancel")',
                    'button:contains("取消")',
                    'button.close-button',
                    'button:contains("Done")',
                    'button:contains("完成")',
                    'button:contains("Close")',
                    'mat-dialog-actions button:last-child'
                ]
            },
            ui: {
                controlPanel: 'automation-controls',
            }
        },
        logStyles: {
            boldBlack: 'color: black; font-weight: bold;',
            boldRed: 'color: red; font-weight: bold;',
            green: 'color: green;',
            orangeBold: 'color: orange; font-weight: bold;',
            red: 'color: red;',
        }
    };

    /**
     * 日志管理器
     */
    class LogManager {
        static info(message, ...args) {
            console.log(message, ...args);
        }
        static styled(message, style, ...args) {
            console.log(`%c${message}`, style, ...args);
        }
        static warn(message, ...args) {
            console.warn(message, ...args);
        }
        static error(message, ...args) {
            console.error(message, ...args);
        }
        static separator(title, isStart = true) {
            const prefix = isStart ? "===== " : "----- ";
            const suffix = isStart ? " =====" : " -----";
            console.log(`\n${prefix}${title}${suffix}`);
        }
        static step(current, total, description) {
            console.log(`步骤 ${current}/${total}: ${description}...`);
        }
        static summary(title) {
            console.log(`\n=================== ${title} ===================`);
        }
        static outputKeys(keys) {
            if (keys.length > 0) {
                console.log("\n--- 所有密钥 (可复制) ---");
                console.log("```\n" + keys.map(key => `${key},`).join('\n') + "\n```");
                console.log("--- 密钥列表结束 ---");
            } else {
                console.log("未生成或提取到密钥。");
            }
        }
        static debug(message, ...args) {
            if (CONFIG.common.debugMode) {
                console.debug(`[DEBUG] ${message}`, ...args);
            }
        }
    }

    /**
     * DOM工具类
     */
    class DOMUtils {
        static delay(milliseconds) {
            return new Promise(resolve => setTimeout(resolve, milliseconds));
        }
        static async waitForElement(selector, timeout = 15000, root = document, checkDisabled = true) {
            const startTime = Date.now();
            while (Date.now() - startTime < timeout) {
                let element;
                try {
                    element = root.querySelector(selector);
                } catch (error) {
                    LogManager.debug(`选择器查询出错: ${error.message}`);
                }
                if (element && element.offsetParent !== null) {
                    const style = window.getComputedStyle(element);
                    if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) {
                        if (!checkDisabled || !element.disabled) {
                            return element;
                        }
                    }
                }
                await this.delay(200); // 减少检查间隔
            }
            throw new Error(`元素 "${selector}" 未在 ${timeout}ms 内出现`);
        }
        static async waitForMultipleElements(selector, minCount = 1, timeout = 20000, root = document) {
            const startTime = Date.now();
            while (Date.now() - startTime < timeout) {
                const elements = root.querySelectorAll(selector);
                if (elements.length >= minCount && elements[0].offsetParent !== null) {
                    return elements;
                }
                await this.delay(250); // 减少检查间隔
            }
            throw new Error(`未能在 ${timeout}ms 内找到至少 ${minCount} 个 "${selector}"`);
        }
        static findButtonByText(text, root = document, baseSelector = 'button') {
            const buttons = root.querySelectorAll(baseSelector);
            const lowerText = text.toLowerCase();
            for (const btn of buttons) {
                if (btn.getAttribute('aria-label')?.toLowerCase().includes(lowerText) ||
                    btn.textContent?.trim().toLowerCase() === lowerText) {
                    return btn;
                }
            }
            return null;
        }
        static async safeClick(element, description, scrollDelay = 300) {
            if (!element) {
                LogManager.warn(`无法点击 ${description}: 元素不存在`);
                return false;
            }
            try {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await this.delay(scrollDelay);
                element.click();
                return true;
            } catch (error) {
                LogManager.error(`点击 ${description} 时出错: ${error.message}`);
                return false;
            }
        }
    }

    /**
     * 对话框管理器
     */
    class DialogManager {
        static async closeDialog(closeButtonSelectors = CONFIG.selectors.dialog.closeButtons, dialogSelector = CONFIG.selectors.dialog.container, timeout = CONFIG.keyGeneration.dialogClosureTimeout) {
            LogManager.info("尝试关闭弹窗...");
            if (!document.querySelector(dialogSelector)) {
                LogManager.info("弹窗已关闭或不存在。");
                return true;
            }
            let dialogClosed = false;
            for (const selector of closeButtonSelectors) {
                try {
                    let button;
                    if (selector.includes(':contains')) {
                        const textMatch = selector.match(/:contains\(['"]?([^'")]+)['"]?\)/i);
                        if (textMatch && textMatch[1]) {
                            button = DOMUtils.findButtonByText(textMatch[1], document, selector.split(':')[0] || 'button');
                        }
                    } else {
                        button = await DOMUtils.waitForElement(selector, timeout, document);
                    }
                    if (button) {
                        LogManager.info(`找到关闭按钮 (${selector})，执行点击...`);
                        if (await DOMUtils.safeClick(button, `关闭按钮 ${selector}`)) {
                            await DOMUtils.delay(500); // 减少等待时间
                            if (!document.querySelector(dialogSelector)) {
                                LogManager.info("弹窗关闭成功。");
                                dialogClosed = true;
                                break;
                            }
                        }
                    }
                } catch (error) {
                    LogManager.debug(`尝试按钮 ${selector} 失败: ${error.message}`);
                }
            }
            if (!dialogClosed) {
                LogManager.warn("无法通过按钮关闭，尝试点击页面主体...");
                try {
                    document.body.click();
                    await DOMUtils.delay(500); // 减少等待时间
                    if (!document.querySelector(dialogSelector)) {
                        LogManager.info("通过点击主体关闭弹窗。");
                        dialogClosed = true;
                    } else {
                        LogManager.error("强制关闭失败，弹窗仍存在！");
                    }
                } catch (error) {
                    LogManager.error("点击主体出错", error);
                }
            }
            return dialogClosed;
        }
    }

    /**
     * 项目生成器
     */
    class ProjectGenerator {
        constructor() {
            this.successfulCreations = 0;
            this.haltedByLimit = false;
            this.haltedByErrorLimit = false;
            this.refreshAttempts = parseInt(GM_getValue(CONFIG.projectGeneration.refreshAttemptCounter, '0'));
        }
        async initialize() {
            if (!location.host.includes("console.cloud.google.com")) {
                window.location.href = "https://console.cloud.google.com";
                return;
            }
            LogManager.styled("智能项目生成工具 (优化模式)", CONFIG.logStyles.boldBlack);
            LogManager.info(`当前会话刷新次数: ${this.refreshAttempts}/${CONFIG.projectGeneration.maxRefreshAttempts}`);
            if (this.refreshAttempts >= CONFIG.projectGeneration.maxRefreshAttempts) {
                LogManager.styled(`刷新次数已达上限 (${CONFIG.projectGeneration.maxRefreshAttempts})，脚本终止。`, CONFIG.logStyles.boldRed);
                return;
            }
            await this.generateProjects();
        }
        async checkQuotaLimit() {
            try {
                const quotaButton = document.querySelector(CONFIG.selectors.projectGeneration.quotaButton);
                const quotaMessages = document.querySelectorAll(CONFIG.selectors.projectGeneration.quotaMessages);
                let quotaExceeded = false;
                quotaMessages.forEach(el => {
                    const text = el.textContent.toLowerCase();
                    if (text.includes('project creation limit') || text.includes('quota has been reached') || text.includes('quota limit')) {
                        quotaExceeded = true;
                    }
                });
                if (quotaButton || quotaExceeded) {
                    LogManager.warn('已达项目配额上限！');
                    return true;
                }
                return false;
            } catch (error) {
                LogManager.styled(`检查配额时出错:`, CONFIG.logStyles.red, error);
                return false;
            }
        }
        async executeProjectCreationSteps() {
            let phase = '初始化';
            try {
                phase = '检查配额限制';
                if (await this.checkQuotaLimit()) {
                    LogManager.warn('配额限制已触发（初始阶段），停止执行。');
                    return { limitReached: true };
                }
                phase = '触发项目选择';
                LogManager.step(1, 3, "激活项目选择器");
                await DOMUtils.delay(CONFIG.projectGeneration.delayAfterButtonClick);
                const projectSelectorButton = await DOMUtils.waitForElement(CONFIG.selectors.projectGeneration.projectSelectorButton);
                projectSelectorButton.click();
                LogManager.info('项目选择器已激活');
                await DOMUtils.delay(CONFIG.projectGeneration.delayAfterProjectSelection);
                phase = '检查弹窗配额';
                if (await this.checkQuotaLimit()) {
                    LogManager.warn('配额限制已触发（弹窗后），停止执行。');
                    await DialogManager.closeDialog();
                    return { limitReached: true };
                }
                phase = '选择新建项目';
                LogManager.step(2, 3, '点击 "新建项目"');
                const newProjectButton = await DOMUtils.waitForElement(CONFIG.selectors.projectGeneration.newProjectButton);
                newProjectButton.click();
                LogManager.info('已选择 "新建项目"');
                await DOMUtils.delay(CONFIG.projectGeneration.delayBeforeConfirmation);
                phase = '创建前配额检查';
                if (await this.checkQuotaLimit()) {
                    LogManager.warn('配额限制已触发（创建前），停止执行。');
                    await DialogManager.closeDialog();
                    return { limitReached: true };
                }
                phase = '确认创建';
                LogManager.step(3, 3, '点击 "创建"');
                const confirmCreateButton = await DOMUtils.waitForElement(CONFIG.selectors.projectGeneration.confirmCreateButton, 20000);
                confirmCreateButton.click();
                LogManager.info('已点击 "创建"，请求已提交。');
                return { limitReached: false };
            } catch (error) {
                LogManager.error(`项目创建在阶段 [${phase}] 出错:`, error);
                await DialogManager.closeDialog();
                if (this.refreshAttempts < CONFIG.projectGeneration.maxRefreshAttempts) {
                    this.refreshAttempts++;
                    GM_setValue(CONFIG.projectGeneration.refreshAttemptCounter, this.refreshAttempts.toString());
                    LogManager.warn(`发生错误！尝试刷新页面 (第 ${this.refreshAttempts}/${CONFIG.projectGeneration.maxRefreshAttempts} 次)...`);
                    await DOMUtils.delay(1000);
                    window.location.reload();
                    return { refreshed: true, error: error };
                } else {
                    LogManager.error(`已达刷新上限 (${CONFIG.projectGeneration.maxRefreshAttempts})，请手动处理。`);
                    GM_setValue(CONFIG.projectGeneration.refreshAttemptCounter, '0');
                    throw new Error(`刷新上限后的错误：${error.message}`);
                }
            }
        }
        async generateProjects() {
            LogManager.info(`即将启动项目生成，目标 ${CONFIG.projectGeneration.desiredProjectCount} 个...`);
            for (let attempt = 1; attempt <= CONFIG.projectGeneration.desiredProjectCount; attempt++) {
                LogManager.separator(`第 ${attempt} 次生成尝试`, true);
                let outcome = null;
                try {
                    outcome = await this.executeProjectCreationSteps();
                    if (outcome?.limitReached) {
                        this.haltedByLimit = true;
                        LogManager.info("配额限制触发，停止生成。");
                        break;
                    }
                    if (!outcome?.refreshed) {
                        this.successfulCreations++;
                        LogManager.info(`第 ${attempt} 次生成成功。`);
                        if (attempt < CONFIG.projectGeneration.desiredProjectCount) {
                            LogManager.info(`等待 ${CONFIG.projectGeneration.intervalBetweenTries / 1000} 秒后继续...`);
                            await DOMUtils.delay(CONFIG.projectGeneration.intervalBetweenTries);
                        }
                    } else {
                        LogManager.info("页面已刷新，当前任务中止。");
                        return;
                    }
                } catch (error) {
                    this.haltedByErrorLimit = true;
                    LogManager.error(`第 ${attempt} 次尝试因错误中止。`);
                    break;
                }
            }
            this.summarizeResults();
        }
        summarizeResults() {
            LogManager.separator('项目生成任务完成', true);
            if (this.haltedByLimit) {
                LogManager.info(`因配额限制停止，共成功生成 ${this.successfulCreations} 个项目。`);
                GM_setValue(CONFIG.projectGeneration.refreshAttemptCounter, '0');
            } else if (this.haltedByErrorLimit) {
                LogManager.info(`因错误或刷新上限停止，共成功生成 ${this.successfulCreations} 个项目。`);
            } else {
                LogManager.info(`完成 ${CONFIG.projectGeneration.desiredProjectCount} 次尝试，共成功生成 ${this.successfulCreations} 个项目。`);
                GM_setValue(CONFIG.projectGeneration.refreshAttemptCounter, '0');
            }
            LogManager.separator('项目生成流程结束', false);
        }
    }

    /**
     * API密钥管理器
     */
    class APIKeyManager {
        async generateKeys() {
            LogManager.separator('开始为项目生成API密钥', false);
            const keysGeneratedSummary = {};
            const collectedKeys = [];
            let projectCount = 0;
            let projectDetailsList = [];
            try {
                LogManager.info("[步骤 0] 获取项目信息...");
                const initialCreateButton = await DOMUtils.waitForElement(CONFIG.selectors.keyGeneration.primaryCreateButton);
                initialCreateButton.click();
                const initialDialog = await DOMUtils.waitForElement(CONFIG.selectors.keyGeneration.modalDialog);
                const queryInput = await DOMUtils.waitForElement(CONFIG.selectors.keyGeneration.projectQueryInput, 15000, initialDialog);
                queryInput.click();
                await DOMUtils.delay(CONFIG.keyGeneration.delayBeforeOptionSelection);
                const initialOptions = await DOMUtils.waitForMultipleElements(CONFIG.selectors.keyGeneration.projectChoice, 1, 20000, document);
                projectCount = initialOptions.length;
                LogManager.info(`发现 ${projectCount} 个项目。`);
                projectDetailsList = Array.from(initialOptions).map((option, index) => {
                    let name = `项目 ${index + 1}`;
                    try {
                        const nameElement = option.querySelector(CONFIG.selectors.keyGeneration.projectNameInOption);
                        if (nameElement && nameElement.textContent) {
                            name = nameElement.textContent.trim();
                        }
                    } catch {}
                    return { name };
                });
                LogManager.info("项目名称概览:", projectDetailsList.map(p => p.name));
                await DialogManager.closeDialog();
            } catch (initialError) {
                LogManager.error("获取项目信息失败:", initialError.message);
                throw initialError;
            }
            if (projectCount === 0) {
                LogManager.info("未找到项目，流程终止。");
                return;
            }
            for (let projectIdx = 0; projectIdx < projectCount; projectIdx++) {
                const projectName = projectDetailsList[projectIdx]?.name || `项目 ${projectIdx + 1}`;
                LogManager.separator(`处理项目 ${projectIdx + 1}/${projectCount}: "${projectName}"`, true);
                keysGeneratedSummary[projectName] = [];
                let skipFurtherTries = false;
                for (let keyTry = 0; keyTry < CONFIG.keyGeneration.keysPerProjectGoal; keyTry++) {
                    if (skipFurtherTries) break;
                    LogManager.separator(`[${projectName}] 尝试生成密钥 ${keyTry + 1}/${CONFIG.keyGeneration.keysPerProjectGoal}`, false);
                    let modalElement = null;
                    let keyElement = null;
                    try {
                        LogManager.info("  [1/7] 点击主创建按钮...");
                        const createBtn = await DOMUtils.waitForElement(CONFIG.selectors.keyGeneration.primaryCreateButton);
                        createBtn.click();
                        await DOMUtils.delay(CONFIG.keyGeneration.delayAfterButtonClick);
                        LogManager.info("  [2/7] 等待弹窗并加载选项...");
                        modalElement = await DOMUtils.waitForElement(CONFIG.selectors.keyGeneration.modalDialog);
                        const inputField = await DOMUtils.waitForElement(CONFIG.selectors.keyGeneration.projectQueryInput, 15000, modalElement);
                        inputField.click();
                        await DOMUtils.delay(CONFIG.keyGeneration.delayBeforeOptionSelection);
                        LogManager.info(`  [3/7] 选择项目 "${projectName}" ...`);
                        const projectOptions = await DOMUtils.waitForMultipleElements(CONFIG.selectors.keyGeneration.projectChoice, projectCount, 20000, document);
                        if (projectIdx >= projectOptions.length) {
                            LogManager.error(`错误: 项目索引 ${projectIdx} 超出范围 (当前项目数 ${projectOptions.length})。`);
                            skipFurtherTries = true;
                            continue;
                        }
                        const selectedOption = projectOptions[projectIdx];
                        selectedOption.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        await DOMUtils.delay(300);
                        selectedOption.click();
                        selectedOption.dispatchEvent(new Event('change', { bubbles: true }));
                        LogManager.info("等待项目选择生效...");
                        await DOMUtils.delay(CONFIG.keyGeneration.delayAfterProjectSelection);
                        LogManager.info("  [4/7] 点击弹窗内创建按钮...");
                        const confirmBtn = await DOMUtils.waitForElement(CONFIG.selectors.keyGeneration.modalCreateButton, 10000, modalElement, false);
                        confirmBtn.click();
                        LogManager.info(`  [5/7] 等待密钥显示（最长${CONFIG.keyGeneration.keyGenerationTimeout/1000}秒）...`);
                        try {
                            keyElement = await DOMUtils.waitForElement(CONFIG.selectors.keyGeneration.keyDisplayElement, CONFIG.keyGeneration.keyGenerationTimeout, document, false);
                            LogManager.info("    密钥元素已加载。");
                        } catch (keyWaitError) {
                            LogManager.warn(`密钥加载超时: ${keyWaitError.message}`);
                            skipFurtherTries = true;
                            await DialogManager.closeDialog();
                            continue;
                        }
                        LogManager.info("  [6/7] 提取密钥...");
                        let keyValue = '';
                        if (keyElement) {
                            keyValue = keyElement.tagName === 'INPUT' ? keyElement.value : keyElement.textContent || keyElement.innerText;
                            keyValue = keyValue.trim();
                            if (keyValue) {
                                LogManager.info(`    成功! 项目 "${projectName}" 的密钥: ${keyValue}`);
                                keysGeneratedSummary[projectName].push(keyValue);
                                collectedKeys.push(keyValue);
                            } else {
                                LogManager.error(`    错误: 提取到空密钥 (尝试 ${keyTry + 1})。`);
                            }
                        } else {
                            LogManager.error(`    内部错误: 未找到密钥元素 (尝试 ${keyTry + 1})`);
                        }
                        LogManager.info("  [7/7] 立即关闭弹窗...");
                        if (!await DialogManager.closeDialog()) { // 优化：立即关闭弹窗
                            LogManager.error("    弹窗关闭失败，跳过此项目后续尝试。");
                            skipFurtherTries = true;
                        }
                        if (!skipFurtherTries) {
                            LogManager.info(`--- 尝试 ${keyTry + 1} 完成，等待 ${CONFIG.keyGeneration.intervalBetweenTries/1000} 秒 ---`);
                            await DOMUtils.delay(CONFIG.keyGeneration.intervalBetweenTries);
                        }
                    } catch (error) {
                        LogManager.error(`项目 "${projectName}" 生成密钥时出错: ${error.message}`);
                        await DialogManager.closeDialog();
                        await DOMUtils.delay(CONFIG.keyGeneration.intervalBetweenTries);
                    }
                }
                if (skipFurtherTries) {
                    LogManager.separator(`项目 "${projectName}" 跳过剩余尝试`, false);
                } else {
                    LogManager.separator(`项目 "${projectName}" 密钥生成完成`, false);
                }
                LogManager.info(`等待 ${CONFIG.keyGeneration.intervalBetweenProjects/1000} 秒后处理下一项目...`);
                await DOMUtils.delay(CONFIG.keyGeneration.intervalBetweenProjects);
            }
            this.summarizeKeyGeneration(keysGeneratedSummary, collectedKeys);
        }
        async extractExistingKeys() {
            console.clear();
            LogManager.separator('开始提取已有API密钥', false);
            if (window.innerWidth < 1200) {
                LogManager.warn("页面宽度不足（" + window.innerWidth + "px），可能影响密钥提取，请放大页面或调整缩放！");
            }
            const projectWiseKeys = {};
            const allExtractedKeys = [];
            let totalKeysExtracted = 0;
            let encounteredCriticalError = false;
            try {
                LogManager.info(`使用项目条目选择器: "${CONFIG.selectors.keyExtraction.projectEntry}"`);
                const projectEntries = document.querySelectorAll(CONFIG.selectors.keyExtraction.projectEntry);
                LogManager.info(`找到 ${projectEntries.length} 个项目条目。`);
                if (projectEntries.length === 0) {
                    LogManager.warn("未找到项目条目，请确认页面已加载并滚动至底部。");
                    return;
                }
                for (let i = 0; i < projectEntries.length; i++) {
                    if (encounteredCriticalError) {
                        LogManager.info(`严重错误触发，在项目 ${i} 处中止。`);
                        break;
                    }
                    const entry = projectEntries[i];
                    let projectTitle = `项目 ${i + 1}`;
                    try {
                        const titleElement = entry.querySelector(CONFIG.selectors.keyExtraction.projectTitle);
                        if (titleElement && titleElement.textContent) {
                            projectTitle = titleElement.textContent.trim();
                        }
                    } catch (titleError) {
                        LogManager.warn(`获取项目 ${i+1} 标题出错: ${titleError.message}`);
                    }
                    LogManager.separator(`处理项目 ${i + 1}/${projectEntries.length}: "${projectTitle}"`, true);
                    projectWiseKeys[projectTitle] = projectWiseKeys[projectTitle] || [];
                    const keyLinks = entry.querySelectorAll(CONFIG.selectors.keyExtraction.shortenedKeyLink);
                    LogManager.info(`找到 ${keyLinks.length} 个密钥链接。`);
                    if (keyLinks.length === 0) {
                        LogManager.info("此项目无密钥链接，跳过。");
                        continue;
                    }
                    for (let j = 0; j < keyLinks.length; j++) {
                        if (encounteredCriticalError) {
                            LogManager.info(`严重错误触发，在项目 "${projectTitle}" 的链接 ${j+1} 处中止。`);
                            break;
                        }
                        const link = keyLinks[j];
                        LogManager.separator(`处理密钥链接 ${j + 1}/${keyLinks.length}`, false);
                        try {
                            LogManager.info("  [1/4] 点击密钥链接...");
                            link.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            await DOMUtils.delay(CONFIG.keyExtraction.delayAfterScroll);
                            link.click();
                            await DOMUtils.delay(CONFIG.keyExtraction.delayAfterClick);
                            LogManager.info(`  [2/4] 等待完整密钥显示 (${CONFIG.selectors.keyExtraction.completeKeyDisplay}) ...`);
                            let fullKeyElement = await DOMUtils.waitForElement(CONFIG.selectors.keyExtraction.completeKeyDisplay, CONFIG.keyExtraction.keyRevealTimeout, document, false);
                            LogManager.info("    完整密钥已加载。");
                            LogManager.info("  [3/4] 提取密钥...");
                            let apiKey = '';
                            if (fullKeyElement) {
                                apiKey = fullKeyElement.tagName === 'INPUT' ? fullKeyElement.value : fullKeyElement.textContent || fullKeyElement.innerText;
                                apiKey = apiKey.trim();
                                if (apiKey && apiKey.startsWith('AIza')) {
                                    LogManager.info(`    提取成功: ${apiKey.substring(0, 10)}...`);
                                    if (!projectWiseKeys[projectTitle].includes(apiKey)) {
                                        projectWiseKeys[projectTitle].push(apiKey);
                                    }
                                    if (!allExtractedKeys.includes(apiKey)) {
                                        allExtractedKeys.push(apiKey);
                                        totalKeysExtracted = allExtractedKeys.length;
                                    } else {
                                        LogManager.info("(密钥已记录)");
                                    }
                                } else {
                                    LogManager.warn(`    提取值 "${apiKey}" 无效，已忽略。`);
                                }
                            } else {
                                LogManager.warn("    未找到完整密钥元素。");
                            }
                            LogManager.info("  [4/4] 立即关闭密钥窗口...");
                            if (!await this.closeKeyRevealDialog(CONFIG.selectors.keyExtraction.hideKeyButton, CONFIG.selectors.keyExtraction.completeKeyDisplay)) {
                                LogManager.error("    无法关闭密钥窗口，脚本终止。");
                                encounteredCriticalError = true;
                                break;
                            }
                            await DOMUtils.delay(CONFIG.keyExtraction.intervalBetweenLinks);
                        } catch (innerError) {
                            LogManager.error(`处理链接 ${j + 1} 出错: ${innerError.message}`);
                            await this.closeKeyRevealDialog(CONFIG.selectors.keyExtraction.hideKeyButton, CONFIG.selectors.keyExtraction.completeKeyDisplay);
                            await DOMUtils.delay(500);
                            LogManager.info("继续处理下一链接...");
                        }
                    }
                }
            } catch (outerError) {
                LogManager.error(`提取过程发生严重错误: ${outerError.message}`);
                encounteredCriticalError = true;
            } finally {
                this.summarizeKeyExtraction(projectWiseKeys, allExtractedKeys, totalKeysExtracted, encounteredCriticalError, projectEntries.length);
            }
        }
        async closeKeyRevealDialog(closeButtonSelector, elementToCheckSelector) {
            LogManager.info("尝试关闭密钥显示窗口...");
            let closed = false;
            try {
                const elementToCheck = document.querySelector(elementToCheckSelector);
                if (!elementToCheck || elementToCheck.offsetParent === null || window.getComputedStyle(elementToCheck).display === 'none') {
                    LogManager.info("密钥窗口已关闭。");
                    return true;
                }
            } catch (error) {
                LogManager.debug(`查找元素出错: ${error.message}`);
            }
            const closeSelectors = Array.isArray(closeButtonSelector) ? closeButtonSelector : [closeButtonSelector];
            for (const selector of closeSelectors) {
                try {
                    const button = await DOMUtils.waitForElement(selector, CONFIG.keyExtraction.dialogClosureTimeout, document, true);
                    if (button && await DOMUtils.safeClick(button, `关闭按钮 ${selector}`)) {
                        await DOMUtils.delay(500); // 减少等待时间
                        if (!document.querySelector(elementToCheckSelector)) {
                            LogManager.info("窗口关闭成功。");
                            return true;
                        }
                    }
                } catch (error) {
                    LogManager.debug(`尝试按钮 ${selector} 失败: ${error.message}`);
                }
            }
            LogManager.warn("无法通过按钮关闭，尝试点击页面主体...");
            try {
                document.body.click();
                await DOMUtils.delay(500); // 减少等待时间
                if (!document.querySelector(elementToCheckSelector)) {
                    LogManager.info("通过点击主体关闭窗口。");
                    return true;
                }
                LogManager.error("强制关闭失败！");
            } catch (error) {
                LogManager.error("点击主体出错", error);
            }
            return false;
        }
        summarizeKeyGeneration(keysGeneratedSummary, collectedKeys) {
            LogManager.summary('密钥生成总结');
            for (const projectName in keysGeneratedSummary) {
                const keys = keysGeneratedSummary[projectName];
                LogManager.info(`项目: "${projectName}" 生成 ${keys.length} 个密钥:`);
                keys.forEach((key, index) => LogManager.info(`  ${index + 1}: ${key}`));
            }
            LogManager.outputKeys(collectedKeys);
            LogManager.separator('密钥生成流程结束', false);
        }
        summarizeKeyExtraction(projectWiseKeys, allExtractedKeys, totalKeysExtracted, encounteredCriticalError, projectEntriesCount) {
            LogManager.summary('提取结果汇总');
            LogManager.info(`共处理 ${projectEntriesCount} 个项目条目。`);
            LogManager.info(`提取到 ${totalKeysExtracted} 个唯一密钥。`);
            if (encounteredCriticalError) {
                LogManager.warn("执行中遇到严重错误，可能未提取全部密钥。");
            } else {
                LogManager.info("提取任务完成。");
            }
            LogManager.outputKeys(allExtractedKeys);
            LogManager.separator('密钥提取流程结束', false);
        }
    }

    /**
     * 用户界面管理器
     */
    class UIManager {
        static createFloatingControls() {
            if (document.getElementById(CONFIG.selectors.ui.controlPanel)) {
                return;
            }
            const controlPanel = document.createElement('div');
            controlPanel.id = CONFIG.selectors.ui.controlPanel;
            controlPanel.style.position = 'fixed';
            controlPanel.style.top = '10px';
            controlPanel.style.right = '10px';
            controlPanel.style.zIndex = '9999';
            controlPanel.style.background = 'rgba(200,200,200,1)';
            controlPanel.style.padding = '10px';
            controlPanel.style.borderRadius = '10px';
            controlPanel.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
            const iconButton = document.createElement('button');
            iconButton.style.background = 'url(https://so.252035.xyz/favicon.ico) no-repeat center';
            iconButton.style.backgroundSize = 'contain';
            iconButton.style.width = '32px';
            iconButton.style.height = '32px';
            iconButton.style.border = 'none';
            iconButton.style.cursor = 'pointer';
            iconButton.title = '生成项目并获取密钥';
            const githubLink = document.createElement('a');
            githubLink.href = 'https://github.com/fish2018/';
            githubLink.target = '_blank';
            githubLink.style.display = 'block';
            githubLink.style.textAlign = 'center';
            githubLink.style.marginTop = '5px';
            githubLink.style.textDecoration = 'none';
            githubLink.style.color = '#0366d6';
            githubLink.style.fontSize = '12px';
            githubLink.textContent = 'GitHub';
            githubLink.title = '访问 GitHub 页面';
            controlPanel.appendChild(iconButton);
            controlPanel.appendChild(githubLink);
            document.body.appendChild(controlPanel);
            iconButton.addEventListener('click', async () => {
                if (!location.host.includes("console.cloud.google.com")) {
                    window.location.href = "https://console.cloud.google.com";
                    return;
                }
                iconButton.disabled = true;
                iconButton.style.opacity = '0.5';
                try {
                    await WorkflowManager.startProjectCreationAndKeyGeneration();
                    iconButton.style.opacity = '1';
                } catch (error) {
                    console.error('执行出错:', error);
                    iconButton.style.opacity = '1';
                }
                setTimeout(() => {
                    iconButton.disabled = false;
                }, 3000);
            });
            githubLink.addEventListener('click', async (e) => {
                if (!location.host.includes("aistudio.google.com")) {
                    e.preventDefault();
                    window.location.href = "https://aistudio.google.com/apikey";
                    await DOMUtils.delay(1000);
                    const apiKeyManager = new APIKeyManager();
                    await apiKeyManager.extractExistingKeys();
                }
            });
        }
        static setupAutoLoading() {
            const observer = new MutationObserver(() => {
                if (document.body) {
                    this.createFloatingControls();
                }
            });
            observer.observe(document, { childList: true, subtree: true });
            setInterval(() => {
                if (!document.getElementById(CONFIG.selectors.ui.controlPanel)) {
                    this.createFloatingControls();
                }
            }, 1000);
            window.addEventListener('DOMContentLoaded', () => this.createFloatingControls());
            window.addEventListener('load', () => this.createFloatingControls());
            this.setupRouteChangeDetection();
            DOMUtils.delay(2000).then(() => this.createFloatingControls());
        }
        static setupRouteChangeDetection() {
            const wrapHistoryMethod = type => {
                const original = history[type];
                return function() {
                    const result = original.apply(this, arguments);
                    window.dispatchEvent(new Event(type));
                    window.dispatchEvent(new Event('locationchange'));
                    return result;
                };
            };
            history.pushState = wrapHistoryMethod('pushState');
            history.replaceState = wrapHistoryMethod('replaceState');
            window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
            window.addEventListener('locationchange', () => this.createFloatingControls());
        }
    }

    /**
     * 工作流管理器
     */
    class WorkflowManager {
        static async startProjectCreationAndKeyGeneration() {
            if (location.host.includes("console.cloud.google.com")) {
                const projectGenerator = new ProjectGenerator();
                await projectGenerator.initialize();
                GM_setValue(CONFIG.common.crossDomainFlag, true);
                window.location.href = "https://aistudio.google.com/apikey";
            } else {
                const apiKeyManager = new APIKeyManager();
                await apiKeyManager.generateKeys();
            }
        }
        static initialize() {
            UIManager.setupAutoLoading();
            if (location.host.includes("aistudio.google.com") && GM_getValue(CONFIG.common.crossDomainFlag, false)) {
                GM_setValue(CONFIG.common.crossDomainFlag, false);
                DOMUtils.delay(1000).then(() => {
                    const apiKeyManager = new APIKeyManager();
                    apiKeyManager.generateKeys();
                });
            }
        }
    }

    // 初始化
    WorkflowManager.initialize();
})();