const DB_NAME = "supplier-yile-reconciliation-library";
const DB_VERSION = 1;
const STORE_NAME = "file-slots";

const slots = [
  { id: "file-1", label: "旺店通代发表" },
  { id: "file-2", label: "运营登记表" },
  { id: "file-3", label: "易乐对账表" },
  { id: "file-4", label: "易乐对账 4" },
];

const generateSlotIds = {
  wdt: "file-1",
  operation: "file-2",
  yile: "file-3",
};

const CHECK_COLUMN_INDEX = 22;
const REMARK_COLUMN_INDEX = 23;
const REVIEW_RESULT_COLUMN_INDEX = 24;
const REVIEW_TYPE_COLUMN_INDEX = 25;
const REVIEW_NOTE_COLUMN_INDEX = 26;
const OUTPUT_LAST_COLUMN_INDEX = REVIEW_NOTE_COLUMN_INDEX;
const PURCHASE_KIND_LABELS = {
  vehicle: "整车购买",
  parts: "配件购买",
};
const MAX_SEARCH_MATCHES = 100;
const TABLE_BORDER_STYLE = {
  style: "thin",
  color: { rgb: "FFB7C4D6" },
};
const THICK_HEADER_BORDER_STYLE = {
  style: "medium",
  color: { rgb: "FF7FA6C8" },
};
const HEADER_FILL = {
  patternType: "solid",
  fgColor: { rgb: "FFD9EAF7" },
};
const OUTPUT_HEADER_FILL = {
  patternType: "solid",
  fgColor: { rgb: "FFBFD7EE" },
};
const HEADER_FONT = {
  bold: true,
  color: { rgb: "FF1F2933" },
};
const HEADER_ALIGNMENT = {
  horizontal: "center",
  vertical: "center",
};
const BODY_ALIGNMENT = {
  vertical: "center",
};
const OUTPUT_ALIGNMENT = {
  horizontal: "center",
  vertical: "center",
};
const NOTE_ALIGNMENT = {
  horizontal: "left",
  vertical: "center",
};
const BODY_FILL = {
  patternType: "solid",
  fgColor: { rgb: "FFFFFFFF" },
};
const ZEBRA_FILL = {
  patternType: "solid",
  fgColor: { rgb: "FFF8FBFF" },
};

const els = {
  slotGrid: document.querySelector("#slotGrid"),
  applyAllButton: document.querySelector("#applyAllButton"),
  generateButton: document.querySelector("#generateButton"),
  clearCacheButton: document.querySelector("#clearCacheButton"),
  libraryState: document.querySelector("#libraryState"),
  sourceNote: document.querySelector("#librarySourceNote"),
  slotCount: document.querySelector("#slotCount"),
  uploadedCount: document.querySelector("#uploadedCount"),
  appliedCount: document.querySelector("#appliedCount"),
  latestMonth: document.querySelector("#latestMonth"),
  yileTotalRows: document.querySelector("#yileTotalRows"),
  verifiedCount: document.querySelector("#verifiedCount"),
  pendingCount: document.querySelector("#pendingCount"),
  returnCount: document.querySelector("#returnCount"),
  noRecordCount: document.querySelector("#noRecordCount"),
};

const state = {
  records: new Map(),
  isGenerating: false,
};

async function init() {
  bindEvents();
  if (window.ensureSharedLibraryLoaded) {
    await window.ensureSharedLibraryLoaded();
  }
  await refresh();
}

function bindEvents() {
  els.slotGrid.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-upload]");
    if (!input) return;
    await savePendingFile(input.dataset.upload, input.files[0]);
    input.value = "";
  });

  els.slotGrid.addEventListener("click", async (event) => {
    const applyButton = event.target.closest("[data-apply]");
    if (applyButton) {
      await applySlot(applyButton.dataset.apply);
      return;
    }

    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      await deleteSlot(deleteButton.dataset.delete);
    }
  });

  els.slotGrid.addEventListener("dragover", (event) => {
    const card = event.target.closest("[data-drop]");
    if (!card) return;
    event.preventDefault();
    card.classList.add("drag-over");
  });

  els.slotGrid.addEventListener("dragleave", (event) => {
    const card = event.target.closest("[data-drop]");
    if (!card || card.contains(event.relatedTarget)) return;
    card.classList.remove("drag-over");
  });

  els.slotGrid.addEventListener("drop", async (event) => {
    const card = event.target.closest("[data-drop]");
    if (!card) return;
    event.preventDefault();
    card.classList.remove("drag-over");
    await savePendingFile(card.dataset.drop, event.dataTransfer?.files?.[0]);
  });

  els.applyAllButton.addEventListener("click", applyAllSlots);
  els.generateButton?.addEventListener("click", generateReconciliationWorkbook);
  els.clearCacheButton?.addEventListener("click", clearLibraryCache);
}

async function refresh() {
  const db = await openDb();
  const entries = await Promise.all(slots.map(async (slot) => [slot.id, await getRecord(db, slot.id)]));
  db.close();
  state.records = new Map(entries);
  render();
}

async function savePendingFile(slotId, file) {
  if (!file) return;
  const now = new Date().toISOString();
  const existing = state.records.get(slotId) || { id: slotId };
  const record = {
    ...existing,
    id: slotId,
    pendingFile: file,
    pendingName: file.name,
    pendingSize: file.size,
    pendingTypeLabel: getFileTypeLabel(file),
    pendingRefreshMonth: getRefreshMonth(file.name, now),
    pendingSavedAt: now,
  };
  const db = await openDb();
  await putRecord(db, record);
  db.close();
  await refresh();
}

async function applySlot(slotId, options = {}) {
  const record = state.records.get(slotId);
  if (!record) return;
  const appliedAt = new Date().toISOString();
  const updatedRecord = record.pendingFile
    ? clearPendingFields({
        ...record,
        file: record.pendingFile,
        name: record.pendingName,
        size: record.pendingSize,
        typeLabel: record.pendingTypeLabel,
        refreshMonth: record.pendingRefreshMonth,
        savedAt: record.pendingSavedAt,
        applied: true,
        appliedAt,
      })
    : {
        ...record,
        applied: true,
        appliedAt,
      };
  const db = await openDb();
  await putRecord(db, updatedRecord);
  db.close();
  if (!options.skipRefresh) await refresh();
}

async function applyAllSlots() {
  const targetSlotIds = slots
    .filter((slot) => {
      const record = state.records.get(slot.id);
      return record?.pendingFile || (record && !record.applied);
    })
    .map((slot) => slot.id);

  els.applyAllButton.disabled = true;
  els.libraryState.textContent = "刷新应用中";
  try {
    for (const slotId of targetSlotIds) {
      await applySlot(slotId, { skipRefresh: true });
    }
    await refresh();
    const result = await refreshReconciliationMetrics();
    if (!result && !els.libraryState.textContent.startsWith("请先上传")) {
      els.libraryState.textContent = targetSlotIds.length ? "已刷新应用" : "暂无待应用文件";
    }
  } catch (error) {
    console.warn("apply all failed", error);
    els.libraryState.textContent = error.message || "刷新应用失败";
  } finally {
    updateApplyAllButton();
  }
}

async function deleteSlot(slotId) {
  const db = await openDb();
  await deleteRecord(db, slotId);
  db.close();
  await refresh();
}

async function clearLibraryCache() {
  const confirmed = window.confirm("确认清除当前浏览器里的易乐对账文件缓存吗？清除后需要重新上传并应用文件。");
  if (!confirmed) return;

  els.clearCacheButton.disabled = true;
  els.libraryState.textContent = "清除中";
  try {
    await deleteLibraryDatabase();
    state.records = new Map();
    updateReconciliationMetrics();
    render();
    els.libraryState.textContent = "已清除缓存";
  } catch (error) {
    console.warn("clear library cache failed", error);
    els.libraryState.textContent = "清除失败";
    window.alert(error.message || "清除缓存失败，请关闭其他对账页面后重试。");
  } finally {
    els.clearCacheButton.disabled = false;
  }
}

async function generateReconciliationWorkbook() {
  if (state.isGenerating) return;
  state.isGenerating = true;
  updateGenerateButton();
  els.libraryState.textContent = "生成中";

  try {
    const { sources, yileWorkbook, result } = await buildReconciliationWorkbookResult();
    updateReconciliationMetrics(result);
    window.XLSX.writeFile(yileWorkbook, buildGeneratedFileName(sources.yile.name), {
      bookType: "xlsx",
      cellStyles: true,
    });
    els.libraryState.textContent = `已生成 ${result.checkedRows} 行`;
  } catch (error) {
    console.warn("generate reconciliation workbook failed", error);
    els.libraryState.textContent = "生成失败";
    window.alert(error.message || "一键生成表失败，请检查文件后重试。");
  } finally {
    state.isGenerating = false;
    updateGenerateButton();
  }
}

async function refreshReconciliationMetrics() {
  try {
    const { result } = await buildReconciliationWorkbookResult();
    updateReconciliationMetrics(result);
    els.libraryState.textContent = `已统计 ${result.checkedRows} 行`;
    return result;
  } catch (error) {
    console.warn("refresh reconciliation metrics failed", error);
    if (error.code === "MISSING_RECONCILIATION_SOURCES") {
      updateReconciliationMetrics();
      els.libraryState.textContent = error.message;
      return null;
    }
    els.libraryState.textContent = "统计失败";
    throw error;
  }
}

async function buildReconciliationWorkbookResult() {
  if (!window.XLSX) {
    throw new Error("Excel 解析组件未加载，请刷新页面后重试。");
  }

  const sources = getGenerateSourceRecords();
  const missingLabels = Object.entries(sources)
    .filter(([, record]) => !record?.file)
    .map(([key]) => getGenerateSourceLabel(key));
  if (missingLabels.length) {
    const error = new Error(`请先上传并应用：${missingLabels.join("、")}`);
    error.code = "MISSING_RECONCILIATION_SOURCES";
    throw error;
  }

  const [wdtWorkbook, operationWorkbook, yileWorkbook] = await Promise.all([
    readWorkbook(sources.wdt.file),
    readWorkbook(sources.operation.file),
    readWorkbook(sources.yile.file),
  ]);
  const wdtEntries = buildWorkbookSearchEntries(wdtWorkbook);
  const operationSets = buildOperationSearchSets(operationWorkbook);
  const yileSheetName = pickYileSheetName(yileWorkbook);
  const yileSheet = yileWorkbook.Sheets[yileSheetName];
  if (!yileSheet) throw new Error("易乐对账表没有可读取的工作表。");

  const result = fillReconciliationSheet(yileSheet, operationSets, wdtEntries);
  return { sources, yileWorkbook, result };
}

function getGenerateSourceRecords() {
  return {
    wdt: getAppliedFileRecord(generateSlotIds.wdt),
    operation: getAppliedFileRecord(generateSlotIds.operation),
    yile: getAppliedFileRecord(generateSlotIds.yile),
  };
}

function getAppliedFileRecord(slotId) {
  const record = state.records.get(slotId);
  return record?.applied && record?.file ? record : null;
}

function getGenerateSourceLabel(key) {
  return {
    wdt: "旺店通代发表",
    operation: "运营登记表",
    yile: "易乐对账表",
  }[key] || key;
}

async function readWorkbook(file) {
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  if (extension === "csv" || extension === "txt") {
    return window.XLSX.read(await file.text(), {
      type: "string",
      raw: false,
      cellStyles: true,
      cellHTML: true,
      cellText: true,
    });
  }
  return window.XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellStyles: true,
    cellHTML: true,
    cellText: true,
  });
}

function buildOperationSearchSets(workbook) {
  const vehicleGroups = [
    {
      label: "D75（985S）发货表",
      names: getSheetNamesByMatcher(workbook, (name) => {
        const normalized = normalizeSearchValue(name);
        return normalized.includes("d75") || normalized.includes("985s");
      }),
    },
    {
      label: "D52&D36发货表",
      names: getSheetNamesByMatcher(workbook, (name) => {
        const normalized = normalizeSearchValue(name);
        return normalized.includes("d52") && normalized.includes("d36");
      }),
    },
  ];
  const partsNames = getSheetNamesByMatcher(workbook, (name) => normalizeSearchValue(name).includes("配件表"));
  const vehicleNames = [...new Set(vehicleGroups.flatMap((group) => group.names))];
  return {
    vehicle: buildWorkbookSearchEntries(workbook, vehicleNames, "vehicle"),
    vehicleMissing: vehicleGroups.filter((group) => !group.names.length).map((group) => group.label),
    parts: buildWorkbookSearchEntries(workbook, partsNames, "parts"),
    partsMissing: partsNames.length ? [] : ["配件表"],
  };
}

function getSheetNamesByMatcher(workbook, matcher) {
  return (workbook.SheetNames || []).filter((name) => matcher(String(name || "")));
}

function buildWorkbookSearchEntries(workbook, sheetNames = workbook.SheetNames || [], defaultKind = "") {
  return sheetNames.flatMap((sheetName) => buildSheetSearchEntries(workbook.Sheets[sheetName], sheetName, defaultKind));
}

function buildSheetSearchEntries(sheet, sheetName, defaultKind = "") {
  if (!sheet) return [];
  const range = window.XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  const headerRow = findLikelyHeaderRow(sheet, range);
  const headers = buildHeaderTexts(sheet, headerRow, range);
  const profileCache = new Map();
  const getProfile = (rowIndex) => {
    if (!profileCache.has(rowIndex)) {
      profileCache.set(rowIndex, buildRowProfile(sheet, rowIndex, range, headers, defaultKind, sheetName));
    }
    return profileCache.get(rowIndex);
  };

  return Object.entries(sheet)
    .filter(([address]) => !address.startsWith("!"))
    .map(([address, cell]) => {
      const decodedAddress = window.XLSX.utils.decode_cell(address);
      if (decodedAddress.r <= headerRow) return null;
      const text = getCellText(cell);
      const profile = getProfile(decodedAddress.r);
      return text
        ? {
            address,
            sheetName,
            rowIndex: decodedAddress.r,
            columnIndex: decodedAddress.c,
            text,
            normalized: normalizeSearchValue(text),
            profile,
            red: isRedFontCell(cell) || profile.red,
            returnLike: isReturnOrUnshippedText(text) || profile.returnLike,
          }
        : null;
    })
    .filter(Boolean);
}

function findLikelyHeaderRow(sheet, range) {
  const maxScanRow = Math.min(range.e.r, range.s.r + 8);
  let bestRow = range.s.r;
  let bestScore = 0;
  for (let rowIndex = range.s.r; rowIndex <= maxScanRow; rowIndex += 1) {
    let score = 0;
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      if (isHeaderLikeText(getSheetCellText(sheet, rowIndex, columnIndex))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = rowIndex;
    }
  }
  return bestScore ? bestRow : range.s.r;
}

function buildHeaderTexts(sheet, headerRow, range) {
  const headers = [];
  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    headers[columnIndex] = getSheetCellText(sheet, headerRow, columnIndex);
  }
  return headers;
}

function buildRowProfile(sheet, rowIndex, range, headers, defaultKind = "", sheetName = "") {
  const rowTexts = [];
  let red = false;
  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    const address = window.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
    const cell = sheet[address];
    const text = getCellText(cell);
    rowTexts[columnIndex] = text;
    if (isRedFontCell(cell)) red = true;
  }
  const fullText = rowTexts.filter(Boolean).join(" ");
  const purchaseKind = detectPurchaseKind(fullText) || defaultKind;
  const canceled = isReturnOrUnshippedText(fullText);
  return {
    id: `${sheetName}!${rowIndex}`,
    sheetName,
    rowIndex,
    rowNumber: rowIndex + 1,
    quantity: getProfileQuantity(headers, rowTexts),
    modelTokens: getProfileModelTokens(headers, rowTexts),
    purchaseKind,
    red,
    canceled,
    returnLike: red || canceled,
    fullText,
  };
}

function isHeaderLikeText(value) {
  return /(客户|子客户|收件|姓名|快递|运单|单号|物流|型号|规格|商品|产品|货品|物料|sku|编码|品名|名称|数量|件数|状态|备注|发货|取消|退款)/i.test(
    String(value || "")
  );
}

function getProfileQuantity(headers, rowTexts) {
  for (let columnIndex = 0; columnIndex < rowTexts.length; columnIndex += 1) {
    if (!isQuantityHeader(headers[columnIndex])) continue;
    const quantity = parseQuantity(rowTexts[columnIndex]);
    if (quantity !== null) return quantity;
  }
  return 1;
}

function isQuantityHeader(value) {
  const text = String(value || "");
  if (/(单号|订单|快递|运单|物流|电话|手机|金额|价格|日期|时间|型号|规格|编码|sku|SKU)/.test(text)) {
    return false;
  }
  return /(数量|件数|发货数|发货数量|订购数|购买数|要得数量|要的数量|实发|应发|需求数|下单数)/.test(text);
}

function parseQuantity(value) {
  const text = String(value || "").replace(/,/g, "").trim();
  if (!text) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const match = text.match(/(?:数量|件数|发货数|购买数|要得数量|要的数量|实发|应发)?[:：]?\s*(-?\d+(?:\.\d+)?)\s*(?:件|台|套|个|辆|pcs)?/i);
  return match ? Number(match[1]) : null;
}

function getProfileModelTokens(headers, rowTexts) {
  const values = [];
  for (let columnIndex = 0; columnIndex < rowTexts.length; columnIndex += 1) {
    if (isModelHeader(headers[columnIndex])) values.push(rowTexts[columnIndex]);
  }
  return extractModelTokens(values.join(" "));
}

function isModelHeader(value) {
  const text = String(value || "");
  if (/(客户|子客户|收件|姓名|电话|手机|地址|单号|订单|运单|快递|物流|状态|数量|件数|金额|价格|日期|时间|备注)/.test(text)) {
    return false;
  }
  return /(型号|规格|商品|产品|货品|物料|sku|SKU|编码|品名|名称|款式|物料号|商品名称)/.test(text);
}

function extractModelTokens(value) {
  const raw = String(value || "");
  const tokens = raw
    .split(/[\s,，、;；/|]+/)
    .map((part) => normalizeSearchValue(part))
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token));
  const compact = normalizeSearchValue(raw);
  if (compact.length >= 2 && !/^\d+$/.test(compact)) tokens.push(compact);
  const codeMatches = raw.match(/[a-z]{0,4}\d{2,}[a-z0-9-]*/gi) || [];
  codeMatches.forEach((match) => {
    const token = normalizeSearchValue(match);
    if (token.length >= 2) tokens.push(token);
  });
  return [...new Set(tokens)].slice(0, 20);
}

function pickYileSheetName(workbook) {
  return (
    (workbook.SheetNames || []).find((name) => String(name || "").includes("对账")) ||
    (workbook.SheetNames || [])[0]
  );
}

function fillReconciliationSheet(sheet, operationSets, wdtEntries) {
  const range = window.XLSX.utils.decode_range(sheet["!ref"] || "A1:AA1");
  const headerRow = range.s.r;
  const maxRow = Math.max(range.e.r, headerRow);
  const originalDataMaxColumn = Math.min(Math.max(range.e.c, 6), CHECK_COLUMN_INDEX - 1);
  const yileContext = buildYileContext(sheet, headerRow, maxRow, originalDataMaxColumn);
  const stats = {
    checkedRows: 0,
    verifiedCount: 0,
    pendingCount: 0,
    returnCount: 0,
    noRecordCount: 0,
  };

  writeTextCell(sheet, headerRow, CHECK_COLUMN_INDEX, "核对确认");
  writeTextCell(sheet, headerRow, REMARK_COLUMN_INDEX, "备注");
  writeTextCell(sheet, headerRow, REVIEW_RESULT_COLUMN_INDEX, "复核结果");
  writeTextCell(sheet, headerRow, REVIEW_TYPE_COLUMN_INDEX, "异常类型");
  writeTextCell(sheet, headerRow, REVIEW_NOTE_COLUMN_INDEX, "复核说明");

  for (let rowIndex = headerRow + 1; rowIndex <= maxRow; rowIndex += 1) {
    if (!rowHasAnyValue(sheet, rowIndex, originalDataMaxColumn)) continue;
    const type = getSheetCellText(sheet, rowIndex, 1);
    const customer = getSheetCellText(sheet, rowIndex, 2);
    const trackingNumber = getSheetCellText(sheet, rowIndex, 6);
    const result = getRowReconciliationResult(
      type,
      customer,
      trackingNumber,
      operationSets,
      wdtEntries,
      yileContext.rows.get(rowIndex),
      yileContext
    );
    writeTextCell(sheet, rowIndex, CHECK_COLUMN_INDEX, result.status);
    writeTextCell(sheet, rowIndex, REMARK_COLUMN_INDEX, result.remark);
    writeTextCell(sheet, rowIndex, REVIEW_RESULT_COLUMN_INDEX, result.reviewResult);
    writeTextCell(sheet, rowIndex, REVIEW_TYPE_COLUMN_INDEX, result.exceptionType);
    writeTextCell(sheet, rowIndex, REVIEW_NOTE_COLUMN_INDEX, result.reviewNote);
    stats.checkedRows += 1;
    if (result.status === "已核实") stats.verifiedCount += 1;
    if (result.status === "待核实") stats.pendingCount += 1;
    if (isReturnRemark(result.remark)) stats.returnCount += 1;
    if (result.status === "无记录") stats.noRecordCount += 1;
  }

  range.e.c = Math.max(range.e.c, OUTPUT_LAST_COLUMN_INDEX);
  range.e.r = Math.max(range.e.r, maxRow);
  sheet["!ref"] = window.XLSX.utils.encode_range(range);
  applyGeneratedTableStyle(sheet, headerRow, range);
  ensureOutputColumnWidths(sheet, range);
  return stats;
}

function buildYileContext(sheet, headerRow, maxRow, originalDataMaxColumn) {
  const range = {
    s: { r: headerRow, c: 0 },
    e: { r: maxRow, c: originalDataMaxColumn },
  };
  const headers = buildHeaderTexts(sheet, headerRow, range);
  const context = {
    rows: new Map(),
    aggregates: new Map(),
  };

  for (let rowIndex = headerRow + 1; rowIndex <= maxRow; rowIndex += 1) {
    if (!rowHasAnyValue(sheet, rowIndex, originalDataMaxColumn)) continue;
    const type = getSheetCellText(sheet, rowIndex, 1);
    const kind = getPurchaseKindFromType(type);
    const customer = getSheetCellText(sheet, rowIndex, 2);
    const trackingNumber = getSheetCellText(sheet, rowIndex, 6);
    const profile = buildRowProfile(sheet, rowIndex, range, headers, kind, "易乐对账表");
    const row = { rowIndex, kind, customer, trackingNumber, profile };
    context.rows.set(rowIndex, row);
    addYileAggregate(context, "customer", kind, customer, row);
    addYileAggregate(context, "tracking", kind, trackingNumber, row);
  }
  return context;
}

function addYileAggregate(context, field, kind, value, row) {
  const key = getYileAggregateKey(field, kind, value);
  if (!key) return;
  if (!context.aggregates.has(key)) {
    context.aggregates.set(key, {
      field,
      kind,
      value,
      quantity: 0,
      rowCount: 0,
      trackingNumbers: new Set(),
      rows: [],
    });
  }
  const aggregate = context.aggregates.get(key);
  aggregate.quantity += getProfileQuantityValue(row.profile);
  aggregate.rowCount += 1;
  const trackingKey = normalizeSearchValue(row.trackingNumber);
  if (trackingKey) aggregate.trackingNumbers.add(trackingKey);
  aggregate.rows.push(row);
}

function getYileAggregate(context, field, kind, value) {
  const key = getYileAggregateKey(field, kind, value);
  return key ? context.aggregates.get(key) || null : null;
}

function getYileAggregateKey(field, kind, value) {
  const normalizedValue = normalizeSearchValue(value);
  if (!field || !kind || !normalizedValue) return "";
  return `${field}|${kind}|${normalizedValue}`;
}

function getRowReconciliationResult(type, customer, trackingNumber, operationSets, wdtEntries, yileRow, yileContext) {
  const typeText = String(type || "").trim();
  const purchaseKind = getPurchaseKindFromType(typeText);
  if (!purchaseKind) {
    return {
      status: typeText,
      remark: "",
      reviewResult: "不适用",
      exceptionType: "",
      reviewNote: "非整车购买/配件购买，按B列原值写入W列。",
    };
  }

  const operationEntries = purchaseKind === "vehicle"
    ? getRequiredOperationEntries(operationSets.vehicle, operationSets.vehicleMissing, typeText)
    : getRequiredOperationEntries(operationSets.parts, operationSets.partsMissing, typeText);
  const customerResult = evaluateLookup(customer, operationEntries, wdtEntries);
  const trackingResult = evaluateLookup(trackingNumber, operationEntries, wdtEntries);
  let status = "";
  let remark = "";

  if (customerResult.both) {
    status = "已核实";
    remark = customerResult.returnLike ? "退货/未发" : "";
  } else if (trackingResult.both) {
    const hasReturnLikeMatch = customerResult.returnLike || trackingResult.returnLike;
    status = "已核实";
    remark = hasReturnLikeMatch ? "退货/未发" : "";
  } else {
    const hasAnyMatch = customerResult.any || trackingResult.any;
    const hasReturnLikeMatch = customerResult.returnLike || trackingResult.returnLike;
    status = hasAnyMatch ? "待核实" : "无记录";
    remark = hasReturnLikeMatch ? "退货/未发" : "";
  }

  const review = buildReviewResult({
    purchaseKind,
    customer,
    trackingNumber,
    status,
    yileRow,
    yileContext,
    operationSets,
    customerResult,
    trackingResult,
  });
  return {
    status,
    remark,
    ...review,
  };
}

function getRequiredOperationEntries(entries, missingLabels, typeText) {
  if (missingLabels.length) {
    throw new Error(`${typeText} 缺少运营登记表 sheet：${missingLabels.join("、")}`);
  }
  return entries;
}

function buildReviewResult({
  purchaseKind,
  customer,
  trackingNumber,
  status,
  yileRow,
  yileContext,
  operationSets,
  customerResult,
  trackingResult,
}) {
  const issues = [];
  const notes = [];
  const expectedOperationEntries = getUniqueRowEntries([
    ...customerResult.operationMatches,
    ...trackingResult.operationMatches,
  ]);
  const expectedOperationProfiles = getUniqueProfiles(expectedOperationEntries);
  const matchedWdtEntries = getUniqueRowEntries([...customerResult.wdtMatches, ...trackingResult.wdtMatches]);

  if (status === "无记录") {
    addIssue(issues, "无匹配记录");
    notes.push("子客户和快递单号均未在运营登记表、旺店通代发表形成有效命中。");
  } else if (status === "待核实") {
    addIssue(issues, "仅单边命中");
    notes.push(`命中状态：${describeLookupResult(customerResult, "子客户")}；${describeLookupResult(trackingResult, "快递单号")}。`);
  }

  appendTypeReviewNotes({
    issues,
    notes,
    purchaseKind,
    customer,
    trackingNumber,
    operationSets,
    expectedOperationProfiles,
  });
  appendModelReviewNotes({
    issues,
    notes,
    yileRow,
    expectedOperationProfiles,
  });
  appendQuantityReviewNotes({
    issues,
    notes,
    purchaseKind,
    customer,
    trackingNumber,
    yileContext,
    expectedOperationProfiles,
  });
  appendCancellationReviewNotes({
    issues,
    notes,
    yileRow,
    trackingNumber,
    expectedOperationProfiles,
    customerResult,
    trackingResult,
    matchedWdtEntries,
  });

  const uniqueIssues = [...new Set(issues)];
  if (!uniqueIssues.length) {
    return {
      reviewResult: "复核通过",
      exceptionType: "",
      reviewNote: notes.length ? dedupeJoin(notes) : "已核实，未发现类型、型号、数量或取消发货异常。",
    };
  }

  return {
    reviewResult: uniqueIssues.length === 1 && uniqueIssues[0] === "仅单边命中" ? "需复核" : "异常",
    exceptionType: uniqueIssues.join("、"),
    reviewNote: dedupeJoin(notes),
  };
}

function appendTypeReviewNotes({ issues, notes, purchaseKind, customer, trackingNumber, operationSets, expectedOperationProfiles }) {
  const oppositeKind = getOppositePurchaseKind(purchaseKind);
  const oppositeEntries = operationSets[oppositeKind] || [];
  const oppositeCustomerResult = searchEntries(customer, oppositeEntries);
  const oppositeTrackingResult = searchEntries(trackingNumber, oppositeEntries);

  if (expectedOperationProfiles.some((profile) => profile.purchaseKind && profile.purchaseKind !== purchaseKind)) {
    addIssue(issues, "类型不一致");
    notes.push(`运营登记表命中行疑似为${getPurchaseKindLabel(getOppositePurchaseKind(purchaseKind))}，与易乐B列${getPurchaseKindLabel(purchaseKind)}不一致。`);
  }

  if (oppositeTrackingResult.found || (!expectedOperationProfiles.length && oppositeCustomerResult.found)) {
    addIssue(issues, "类型不一致");
    notes.push(`按${oppositeTrackingResult.found ? "快递单号" : "子客户"}在运营登记表${getPurchaseKindLabel(oppositeKind)}范围内也有命中，需核对实际发货类型。`);
  } else if (oppositeCustomerResult.found) {
    notes.push(`同一子客户在运营登记表${getPurchaseKindLabel(oppositeKind)}范围内也有记录，需留意是否混发或登记类型错位。`);
  }
}

function appendModelReviewNotes({ issues, notes, yileRow, expectedOperationProfiles }) {
  const yileTokens = yileRow?.profile?.modelTokens || [];
  const operationTokens = [...new Set(expectedOperationProfiles.flatMap((profile) => profile.modelTokens || []))];
  if (!yileTokens.length || !operationTokens.length) return;
  if (hasMeaningfulTokenOverlap(yileTokens, operationTokens)) return;
  addIssue(issues, "型号不一致");
  notes.push(`型号复核：易乐表为${formatTokens(yileTokens)}，运营登记表为${formatTokens(operationTokens)}。`);
}

function appendQuantityReviewNotes({ issues, notes, purchaseKind, customer, trackingNumber, yileContext, expectedOperationProfiles }) {
  const customerAggregate = getYileAggregate(yileContext, "customer", purchaseKind, customer);
  const trackingAggregate = getYileAggregate(yileContext, "tracking", purchaseKind, trackingNumber);
  const aggregate = customerAggregate || trackingAggregate;
  if (!aggregate || !expectedOperationProfiles.length) return;

  const yileQuantity = aggregate.quantity;
  const operationQuantity = sumProfileQuantity(expectedOperationProfiles);
  if (Number.isFinite(yileQuantity) && Number.isFinite(operationQuantity) && Math.abs(yileQuantity - operationQuantity) > 0.000001) {
    addIssue(issues, yileQuantity > operationQuantity ? "疑似多发" : "数量不一致");
    notes.push(`数量复核：易乐合计${formatQuantity(yileQuantity)}，运营登记表合计${formatQuantity(operationQuantity)}。`);
  }

  if (aggregate.rowCount > 1 || aggregate.trackingNumbers.size > 1) {
    notes.push(`同一${aggregate.field === "customer" ? "子客户" : "快递单号"}在易乐表有${aggregate.rowCount}行、${aggregate.trackingNumbers.size || 1}个快递单号，已按${getPurchaseKindLabel(purchaseKind)}汇总数量复核。`);
  }
}

function appendCancellationReviewNotes({
  issues,
  notes,
  yileRow,
  trackingNumber,
  expectedOperationProfiles,
  customerResult,
  trackingResult,
  matchedWdtEntries,
}) {
  const operationCanceled = expectedOperationProfiles.some((profile) => profile.returnLike || profile.canceled || profile.red)
    || customerResult.operationReturnLike
    || trackingResult.operationReturnLike;
  if (!operationCanceled) return;

  const yileCanceled = Boolean(yileRow?.profile?.returnLike || yileRow?.profile?.canceled);
  const yileLooksShipped = Boolean(normalizeSearchValue(trackingNumber)) || matchedWdtEntries.length > 0 || customerResult.wdtFound || trackingResult.wdtFound;
  if (!yileCanceled && yileLooksShipped) {
    addIssue(issues, "运营已取消但易乐未取消发货");
    notes.push("运营登记表命中取消/退款/退货/未发或红字记录，但易乐行仍有发货线索，需核对是否应取消发货。");
  }
}

function addIssue(issues, issue) {
  if (issue && !issues.includes(issue)) issues.push(issue);
}

function describeLookupResult(result, label) {
  if (result.both) return `${label}两边命中`;
  if (result.operationFound) return `${label}仅运营登记表命中`;
  if (result.wdtFound) return `${label}仅旺店通代发表命中`;
  return `${label}未命中`;
}

function getUniqueRowEntries(entries) {
  const seen = new Set();
  const unique = [];
  for (const entry of entries || []) {
    const key = `${entry.sheetName || ""}|${entry.rowIndex ?? entry.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function getUniqueProfiles(entries) {
  const seen = new Set();
  const profiles = [];
  for (const entry of entries || []) {
    const profile = entry.profile;
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    profiles.push(profile);
  }
  return profiles;
}

function sumProfileQuantity(profiles) {
  return profiles.reduce((total, profile) => total + getProfileQuantityValue(profile), 0);
}

function getProfileQuantityValue(profile) {
  const quantity = Number(profile?.quantity);
  return Number.isFinite(quantity) ? quantity : 1;
}

function hasMeaningfulTokenOverlap(leftTokens, rightTokens) {
  return leftTokens.some((left) => rightTokens.some((right) => modelTokensMatch(left, right)));
}

function modelTokensMatch(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  return (left.length >= 3 && right.includes(left)) || (right.length >= 3 && left.includes(right));
}

function formatTokens(tokens) {
  return tokens.slice(0, 5).join("、") || "--";
}

function formatQuantity(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function dedupeJoin(values) {
  return [...new Set(values.filter(Boolean))].join("；");
}

function isVehiclePurchase(typeText) {
  return String(typeText || "").trim().includes("整车购买");
}

function isPartsPurchase(typeText) {
  return String(typeText || "").trim().includes("配件购买");
}

function getPurchaseKindFromType(typeText) {
  if (isVehiclePurchase(typeText)) return "vehicle";
  if (isPartsPurchase(typeText)) return "parts";
  return "";
}

function detectPurchaseKind(value) {
  const text = String(value || "");
  if (isVehiclePurchase(text) || text.includes("整车")) return "vehicle";
  if (isPartsPurchase(text) || text.includes("配件")) return "parts";
  return "";
}

function getOppositePurchaseKind(kind) {
  return kind === "vehicle" ? "parts" : "vehicle";
}

function getPurchaseKindLabel(kind) {
  return PURCHASE_KIND_LABELS[kind] || kind || "--";
}

function evaluateLookup(query, operationEntries, wdtEntries) {
  const operationResult = searchEntries(query, operationEntries);
  const wdtResult = searchEntries(query, wdtEntries);
  return {
    operationFound: operationResult.found,
    wdtFound: wdtResult.found,
    operationMatches: operationResult.matches,
    wdtMatches: wdtResult.matches,
    operationReturnLike: operationResult.returnLike,
    wdtReturnLike: wdtResult.returnLike,
    both: operationResult.found && wdtResult.found,
    any: operationResult.found || wdtResult.found,
    returnLike: operationResult.returnLike || wdtResult.returnLike,
  };
}

function searchEntries(query, entries) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return { found: false, returnLike: false, matches: [] };
  let found = false;
  let returnLike = false;
  const matches = [];
  const seenRows = new Set();
  for (const entry of entries) {
    if (!entry.normalized || !entry.normalized.includes(normalizedQuery)) continue;
    found = true;
    if (entry.red || entry.returnLike || entry.profile?.returnLike) returnLike = true;
    const key = `${entry.sheetName || ""}|${entry.rowIndex ?? entry.address}`;
    if (!seenRows.has(key) && matches.length < MAX_SEARCH_MATCHES) {
      seenRows.add(key);
      matches.push(entry);
    }
  }
  return { found, returnLike, matches };
}

function rowHasAnyValue(sheet, rowIndex, maxColumnIndex) {
  for (let columnIndex = 0; columnIndex <= maxColumnIndex; columnIndex += 1) {
    if (getSheetCellText(sheet, rowIndex, columnIndex)) return true;
  }
  return false;
}

function getSheetCellText(sheet, rowIndex, columnIndex) {
  return getCellText(sheet[window.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })]);
}

function getCellText(cell) {
  if (!cell) return "";
  return String(cell.w ?? cell.v ?? "").trim();
}

function writeTextCell(sheet, rowIndex, columnIndex, value) {
  sheet[window.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })] = {
    t: "s",
    v: String(value ?? ""),
  };
}

function ensureOutputColumnWidths(sheet, range = null) {
  const columns = sheet["!cols"] || [];
  const startColumn = range?.s?.c ?? 0;
  const endColumn = Math.max(range?.e?.c ?? OUTPUT_LAST_COLUMN_INDEX, OUTPUT_LAST_COLUMN_INDEX);
  for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
    const existing = columns[columnIndex] || {};
    columns[columnIndex] = {
      ...existing,
      hidden: false,
      level: 0,
      collapsed: false,
      wch: Math.max(Number(existing.wch) || 0, getGeneratedColumnWidth(columnIndex)),
    };
  }
  columns[CHECK_COLUMN_INDEX].wch = Math.max(columns[CHECK_COLUMN_INDEX].wch || 0, 13);
  columns[REMARK_COLUMN_INDEX].wch = Math.max(columns[REMARK_COLUMN_INDEX].wch || 0, 14);
  columns[REVIEW_RESULT_COLUMN_INDEX].wch = Math.max(columns[REVIEW_RESULT_COLUMN_INDEX].wch || 0, 13);
  columns[REVIEW_TYPE_COLUMN_INDEX].wch = Math.max(columns[REVIEW_TYPE_COLUMN_INDEX].wch || 0, 30);
  columns[REVIEW_NOTE_COLUMN_INDEX].wch = Math.max(columns[REVIEW_NOTE_COLUMN_INDEX].wch || 0, 80);
  sheet["!cols"] = columns;
}

function getGeneratedColumnWidth(columnIndex) {
  if (columnIndex === 1 || columnIndex === 2) return 16;
  if (columnIndex === 3 || columnIndex === 4 || columnIndex === 5) return 18;
  if (columnIndex === 6) return 22;
  return 14;
}

function applyGeneratedTableStyle(sheet, headerRow, range) {
  const styledRange = {
    s: { r: headerRow, c: range.s.c },
    e: { r: range.e.r, c: Math.max(range.e.c, OUTPUT_LAST_COLUMN_INDEX) },
  };
  sheet["!autofilter"] = {
    ref: window.XLSX.utils.encode_range({
      s: { r: headerRow, c: styledRange.s.c },
      e: { r: headerRow, c: styledRange.e.c },
    }),
  };

  const rows = sheet["!rows"] || [];
  normalizeGeneratedRows(rows, styledRange, headerRow);

  Object.entries(sheet)
    .filter(([address, cell]) => !address.startsWith("!") && isCellInRange(address, styledRange) && cellHasDisplayValue(cell))
    .forEach(([address, cell]) => {
      const position = window.XLSX.utils.decode_cell(address);
      cell.s = getGeneratedCellStyle(cell, position.r, position.c, headerRow);
      sheet[address] = cell;
    });
  sheet["!rows"] = rows;
}

function isCellInRange(address, range) {
  const position = window.XLSX.utils.decode_cell(address);
  return position.r >= range.s.r && position.r <= range.e.r && position.c >= range.s.c && position.c <= range.e.c;
}

function cellHasDisplayValue(cell) {
  return getCellText(cell) !== "";
}

function normalizeGeneratedRows(rows, styledRange, headerRow) {
  for (let rowIndex = styledRange.s.r; rowIndex <= styledRange.e.r; rowIndex += 1) {
    const row = { ...(rows[rowIndex] || {}) };
    row.hidden = false;
    row.level = 0;
    row.collapsed = false;
    delete row.hpx;
    delete row.hpt;
    if (rowIndex === headerRow) row.hpt = 24;
    rows[rowIndex] = row;
  }
}

function getCellBorder() {
  return {
    top: TABLE_BORDER_STYLE,
    bottom: TABLE_BORDER_STYLE,
    left: TABLE_BORDER_STYLE,
    right: TABLE_BORDER_STYLE,
  };
}

function getHeaderCellBorder() {
  return {
    top: THICK_HEADER_BORDER_STYLE,
    bottom: THICK_HEADER_BORDER_STYLE,
    left: TABLE_BORDER_STYLE,
    right: TABLE_BORDER_STYLE,
  };
}

function getGeneratedCellStyle(cell, rowIndex, columnIndex, headerRow) {
  const isHeader = rowIndex === headerRow;
  const currentStyle = cell.s || {};
  const value = getCellText(cell);
  const style = {
    ...currentStyle,
    border: isHeader ? getHeaderCellBorder() : getCellBorder(),
    alignment: getGeneratedCellAlignment(columnIndex, isHeader),
    fill: isHeader ? getHeaderFill(columnIndex) : getBodyFill(rowIndex),
  };

  if (isHeader) {
    style.font = { ...(currentStyle.font || {}), ...HEADER_FONT };
    return style;
  }

  const resultStyle = getResultCellStyle(columnIndex, value);
  if (resultStyle.fill) style.fill = resultStyle.fill;
  if (resultStyle.font) style.font = { ...(currentStyle.font || {}), ...resultStyle.font };
  return style;
}

function getGeneratedCellAlignment(columnIndex, isHeader) {
  if (isHeader) return HEADER_ALIGNMENT;
  if (columnIndex === REVIEW_NOTE_COLUMN_INDEX) return NOTE_ALIGNMENT;
  if (columnIndex >= CHECK_COLUMN_INDEX && columnIndex <= REVIEW_TYPE_COLUMN_INDEX) return OUTPUT_ALIGNMENT;
  return BODY_ALIGNMENT;
}

function getHeaderFill(columnIndex) {
  return columnIndex >= CHECK_COLUMN_INDEX && columnIndex <= OUTPUT_LAST_COLUMN_INDEX ? OUTPUT_HEADER_FILL : HEADER_FILL;
}

function getBodyFill(rowIndex) {
  return rowIndex % 2 === 0 ? ZEBRA_FILL : BODY_FILL;
}

function getResultCellStyle(columnIndex, value) {
  const text = String(value || "").trim();
  if (columnIndex === CHECK_COLUMN_INDEX) return getCheckStatusStyle(text);
  if (columnIndex === REMARK_COLUMN_INDEX && isReturnRemark(text)) return getReturnRemarkStyle();
  if (columnIndex === REVIEW_RESULT_COLUMN_INDEX) return getReviewResultStyle(text);
  if (columnIndex === REVIEW_TYPE_COLUMN_INDEX && text) return getExceptionTypeStyle(text);
  if (columnIndex === REVIEW_NOTE_COLUMN_INDEX && text) return getReviewNoteStyle();
  return {};
}

function getCheckStatusStyle(value) {
  if (value === "已核实") {
    return {
      fill: solidFill("FFE6F4EA"),
      font: { bold: true, color: { rgb: "FF146C43" } },
    };
  }
  if (value === "待核实") {
    return {
      fill: solidFill("FFFFF4D6"),
      font: { bold: true, color: { rgb: "FF8A5A00" } },
    };
  }
  if (value === "无记录") {
    return {
      fill: solidFill("FFFFE4E6"),
      font: { bold: true, color: { rgb: "FFB42318" } },
    };
  }
  return {};
}

function getReturnRemarkStyle() {
  return {
    fill: solidFill("FFFFE4E6"),
    font: { bold: true, color: { rgb: "FFB42318" } },
  };
}

function getReviewResultStyle(value) {
  if (value === "复核通过") {
    return {
      fill: solidFill("FFE6F4EA"),
      font: { bold: true, color: { rgb: "FF146C43" } },
    };
  }
  if (value === "需复核") {
    return {
      fill: solidFill("FFFFF4D6"),
      font: { bold: true, color: { rgb: "FF8A5A00" } },
    };
  }
  if (value === "异常") {
    return {
      fill: solidFill("FFFFE4E6"),
      font: { bold: true, color: { rgb: "FFB42318" } },
    };
  }
  if (value === "不适用") {
    return {
      fill: solidFill("FFF1F5F9"),
      font: { color: { rgb: "FF64748B" } },
    };
  }
  return {};
}

function getExceptionTypeStyle() {
  return {
    fill: solidFill("FFFFF1F2"),
    font: { bold: true, color: { rgb: "FFB42318" } },
  };
}

function getReviewNoteStyle() {
  return {
    fill: solidFill("FFF8FBFF"),
    font: { color: { rgb: "FF334155" } },
  };
}

function solidFill(rgb) {
  return {
    patternType: "solid",
    fgColor: { rgb },
  };
}

function isRedFontCell(cell) {
  if (!cell) return false;
  const fontColor = cell.s?.font?.color;
  if (isRedColor(fontColor?.rgb) || isRedIndexedColor(fontColor?.indexed)) return true;
  if (Array.isArray(cell.r) && cell.r.some((run) => isRedColor(run?.s?.color?.rgb))) return true;
  return /color\s*:\s*(#?ff0000|#?c00000|red)\b/i.test(String(cell.h || ""));
}

function isReturnOrUnshippedText(value) {
  return /(取消|退款|退货|未发)/.test(String(value || ""));
}

function isReturnRemark(value) {
  return /(退货|未发)/.test(String(value || ""));
}

function isRedIndexedColor(indexed) {
  return Number(indexed) === 3 || Number(indexed) === 10;
}

function isRedColor(value) {
  const raw = String(value || "").replace(/[^0-9a-f]/gi, "");
  if (!raw) return false;
  const hex = raw.length > 6 ? raw.slice(-6) : raw.padStart(6, "0");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return red >= 180 && green <= 90 && blue <= 90;
}

function normalizeSearchValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\.0$/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function buildGeneratedFileName(sourceName) {
  const baseName = sanitizeFileNamePart(String(sourceName || "易乐对账表").replace(/\.[^.]+$/, "")) || "易乐对账表";
  const stamp = formatFileTimestamp(new Date());
  return `${baseName}_已核对_${stamp}.xlsx`;
}

function formatFileTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function sanitizeFileNamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "");
}

function render() {
  els.slotCount.textContent = String(slots.length);
  els.uploadedCount.textContent = String(countUploadedRecords());
  els.appliedCount.textContent = String(countAppliedRecords());
  els.latestMonth.textContent = getLatestMonth();
  els.sourceNote.textContent = `本地文件库｜引用时间：${getLatestAppliedTime()}`;
  els.slotGrid.innerHTML = slots.map(renderSlot).join("");
  updateReconciliationMetrics();
  els.libraryState.textContent = "本地文件库";
  updateApplyAllButton();
  updateGenerateButton();
}

function updateReconciliationMetrics(stats = {}) {
  if (els.yileTotalRows) els.yileTotalRows.textContent = String(stats.checkedRows || 0);
  if (els.verifiedCount) els.verifiedCount.textContent = String(stats.verifiedCount || 0);
  if (els.pendingCount) els.pendingCount.textContent = String(stats.pendingCount || 0);
  if (els.returnCount) els.returnCount.textContent = String(stats.returnCount || 0);
  if (els.noRecordCount) els.noRecordCount.textContent = String(stats.noRecordCount || 0);
}

function renderSlot(slot) {
  const record = state.records.get(slot.id);
  const display = getDisplayRecord(record);
  const hasPending = Boolean(record?.pendingFile);
  const isApplied = Boolean(record?.applied && !hasPending);
  return `
    <article class="slot-card ${isApplied ? "applied" : ""}" data-drop="${slot.id}">
      <div class="slot-head">
        <div>
          <p class="eyebrow">Slot</p>
          <h2>${escapeHtml(slot.label)}</h2>
        </div>
        <span class="slot-status ${isApplied ? "applied" : hasPending ? "pending" : ""}">
          ${isApplied ? "已引用" : hasPending ? "待应用" : "未上传"}
        </span>
      </div>
      <div class="file-meta">
        <span>${escapeHtml(display?.name || "未上传文件")}</span>
        <strong>${display ? `${escapeHtml(display.typeLabel)} / ${formatFileSize(display.size)}` : "--"}</strong>
        <small>刷新月份：${escapeHtml(display?.refreshMonth || "--")}</small>
        <small>更新时间：${formatDateTime(display?.savedAt)}</small>
        <small>引用时间：${formatDateTime(record?.appliedAt)}</small>
      </div>
      <div class="slot-actions">
        <label class="upload-button">
          <input type="file" accept=".xlsx,.xls,.csv,.txt,.pdf" data-upload="${slot.id}" />
          上传/替换
        </label>
        <button type="button" data-apply="${slot.id}" ${hasPending || (record && !record.applied) ? "" : "disabled"}>应用刷新</button>
        <button class="danger-button" type="button" data-delete="${slot.id}" ${record ? "" : "disabled"}>删除</button>
      </div>
    </article>
  `;
}

function getDisplayRecord(record) {
  if (!record) return null;
  if (record.pendingFile) {
    return {
      name: record.pendingName,
      size: record.pendingSize,
      typeLabel: record.pendingTypeLabel,
      refreshMonth: record.pendingRefreshMonth,
      savedAt: record.pendingSavedAt,
    };
  }
  return record;
}

function countUploadedRecords() {
  return slots.filter((slot) => {
    const record = state.records.get(slot.id);
    return record?.file || record?.pendingFile;
  }).length;
}

function countAppliedRecords() {
  return slots.filter((slot) => state.records.get(slot.id)?.applied).length;
}

function getLatestMonth() {
  const times = slots
    .map((slot) => getDisplayRecord(state.records.get(slot.id))?.savedAt)
    .filter(Boolean)
    .sort();
  if (!times.length) return "--";
  return getMonthFromDate(times.at(-1));
}

function getLatestAppliedTime() {
  const times = slots
    .map((slot) => state.records.get(slot.id)?.appliedAt)
    .filter(Boolean)
    .sort();
  if (!times.length) return "--";
  return formatDateTime(times.at(-1));
}

function updateApplyAllButton() {
  const hasAnyRecord = slots.some((slot) => {
    const record = state.records.get(slot.id);
    return record?.pendingFile || record?.file || record;
  });
  els.applyAllButton.disabled = !hasAnyRecord;
}

function updateGenerateButton() {
  if (!els.generateButton) return;
  const sources = getGenerateSourceRecords();
  const hasRequiredSources = Boolean(sources.wdt?.file && sources.operation?.file && sources.yile?.file);
  els.generateButton.disabled = state.isGenerating || !hasRequiredSources;
}

function clearPendingFields(record) {
  const nextRecord = { ...record };
  delete nextRecord.pendingFile;
  delete nextRecord.pendingName;
  delete nextRecord.pendingSize;
  delete nextRecord.pendingTypeLabel;
  delete nextRecord.pendingRefreshMonth;
  delete nextRecord.pendingSavedAt;
  return nextRecord;
}

function getRefreshMonth(fileName, fallbackTime) {
  const name = String(fileName || "");
  const compact = name.match(/(20\d{2})(0[1-9]|1[0-2])/);
  if (compact) return `${compact[1]}-${compact[2]}`;
  const separated = name.match(/(20\d{2})[-_.年 ]+(0?[1-9]|1[0-2])/);
  if (separated) return `${separated[1]}-${String(separated[2]).padStart(2, "0")}`;
  return getMonthFromDate(fallbackTime);
}

function getMonthFromDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getFileTypeLabel(file) {
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  if (extension === "xlsx" || extension === "xls") return "Excel 工作簿";
  if (extension === "csv") return "CSV 文件";
  if (extension === "txt") return "文本文件";
  if (extension === "pdf") return "PDF 文件";
  return file?.type || "文件";
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "--";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteLibraryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("文件库正被其他页面占用，请关闭其他对账页面后重试。"));
  });
}

function getRecord(db, key) {
  return runStoreRequest(db, "readonly", (store) => store.get(key));
}

function putRecord(db, record) {
  return runStoreRequest(db, "readwrite", (store) => store.put(record));
}

function deleteRecord(db, key) {
  return runStoreRequest(db, "readwrite", (store) => store.delete(key));
}

function runStoreRequest(db, mode, createRequest) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = createRequest(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

init().catch((error) => {
  console.error(error);
  els.libraryState.textContent = "读取失败";
});
