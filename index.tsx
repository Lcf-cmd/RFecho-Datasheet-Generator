
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// PDF.js worker setup
// @ts-ignore
const pdfjsLib = window.pdfjsLib;
if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

type AssetRole = 'main' | 'outline' | 'curve' | 'none';

interface ManualAsset {
  id: string;
  file: File;
  preview: string;
  role: AssetRole;
}

interface BatchItem {
  id: string;
  pdf: File;
  relativePath: string;
  assets: ManualAsset[];
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

interface TableData {
  title: string;
  headers: string[];
  rows: string[][];
}

interface ExtractionResult {
  productId: string;
  productName: string;
  description: string;
  features: string[];
  specsTable?: TableData;
  environmentalParams?: TableData;
  absoluteMaxRatings?: TableData;
  truthTable?: TableData;
  imageBoxes?: {
    main?: { page: number; box: [number, number, number, number] };
    outline?: { page: number; box: [number, number, number, number] };
    curves?: { page: number; box: [number, number, number, number] }[];
  };
}

const App = () => {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [isBatchMode, setIsBatchMode] = useState(false);
  
  const [manualProductId, setManualProductId] = useState("");
  const [manualProductTitle, setManualProductTitle] = useState("");
  
  const containsChinese = (text: string) => /[\u4e00-\u9fa5]/.test(text);

  const translateToEnglish = async (text: string, ai: any) => {
    if (!text || !containsChinese(text)) return text;
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ parts: [{ text: `Translate the following technical text into professional English for a product datasheet. Return ONLY the translated text, preserving technical values and units: "${text}"` }] }],
      });
      return response.text.trim().replace(/^"|"$/g, '');
    } catch (err) {
      console.error("Translation failed:", err);
      return text;
    }
  };

  const translateObject = async (obj: any, ai: any): Promise<any> => {
    if (typeof obj === 'string') {
      return await translateToEnglish(obj, ai);
    }
    if (Array.isArray(obj)) {
      const results = [];
      for (const item of obj) {
        results.push(await translateObject(item, ai));
      }
      return results;
    }
    if (typeof obj === 'object' && obj !== null) {
      const newObj: any = {};
      for (const key in obj) {
        // Skip imageBoxes as they contain numbers/coordinates
        if (key === 'imageBoxes') {
          newObj[key] = obj[key];
          continue;
        }
        newObj[key] = await translateObject(obj[key], ai);
      }
      return newObj;
    }
    return obj;
  };

  const resetMasterIdentity = () => {
    localStorage.removeItem('logo_png');
    localStorage.removeItem('top_png');
    localStorage.removeItem('bottom_png');
    setLogo(null);
    setBottomImg(null);
    // Note: top_png is handled via localStorage directly in the render
  };

  const resetManualOverride = () => {
    setManualProductId("");
    setManualProductTitle("");
  };

  const resetSingleMatch = () => {
    setSingleAssets([]);
  };

  const [logo, setLogo] = useState<string | null>(localStorage.getItem('logo_png'));
  const [bottomImg, setBottomImg] = useState<string | null>(localStorage.getItem('bottom_png'));

  const [rawPdfs, setRawPdfs] = useState<File[]>([]);
  const [rawImages, setRawImages] = useState<File[]>([]);
  const [batchQueue, setBatchQueue] = useState<BatchItem[]>([]);
  const [singleAssets, setSingleAssets] = useState<ManualAsset[]>([]);

  const getNormalizedSubPath = (file: File, isPdf: boolean = false) => {
    const fullPath = (file as any).webkitRelativePath || file.name;
    const segments = fullPath.split('/');
    if (segments.length > 1) segments.shift(); 
    
    let path = segments.join('/');
    if (isPdf) {
      return path.replace(/\.pdf$/i, '');
    } else {
      segments.pop(); 
      return segments.join('/');
    }
  };

  useEffect(() => {
    if (rawPdfs.length > 0) {
      const newQueue: BatchItem[] = rawPdfs.map(pdf => {
        const pdfSubPath = getNormalizedSubPath(pdf, true);
        const matchedImages = rawImages.filter(img => {
          const imgParentPath = getNormalizedSubPath(img, false);
          return imgParentPath === pdfSubPath;
        });

        const assets: ManualAsset[] = matchedImages.map(img => {
          const name = img.name.toLowerCase();
          let role: AssetRole = 'curve';
          if (name.includes('main')) role = 'main';
          else if (name.includes('outline')) role = 'outline';
          return {
            id: Math.random().toString(36).substr(2, 9),
            file: img,
            preview: URL.createObjectURL(img),
            role
          };
        });

        return {
          id: Math.random().toString(36).substr(2, 9),
          pdf,
          relativePath: pdfSubPath,
          assets,
          status: 'pending'
        };
      });
      setBatchQueue(newQueue);
    }
  }, [rawPdfs, rawImages]);

  const handlePersistentAsset = (e: React.ChangeEvent<HTMLInputElement>, key: string, setter: (val: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        localStorage.setItem(key, base64);
        setter(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePdfFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const pdfs = Array.from(files).filter((f: any) => f.name.toLowerCase().endsWith('.pdf')) as File[];
    setRawPdfs(pdfs);
  };

  const handleImageFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const imgs = Array.from(files).filter((f: any) => /\.(png|jpe?g)$/i.test(f.name)) as File[];
    setRawImages(imgs);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const extractPagesAsImages = async (pdfFile: File): Promise<string[]> => {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images: string[] = [];
    // 限制 8 页以防负载过大
    for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // 略微降低缩放以平衡内存
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.85));
    }
    return images;
  };

  const cropImage = (base64: string, box: any): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!box || !Array.isArray(box) || box.length !== 4) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const [ymin, xmin, ymax, xmax] = box;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const width = (xmax - xmin) * img.width / 1000;
        const height = (ymax - ymin) * img.height / 1000;
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, (xmin * img.width / 1000), (ymin * img.height / 1000), width, height, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = base64;
    });
  };

  const sanitizeText = (text: string) => {
    if (!text) return "";
    return text
      .replace(/℃/g, ' degC').replace(/uA/g, ' uA').replace(/µA/g, ' uA').replace(/OHM/gi, ' Ohm').replace(/Ω/g, ' Ohm')
      .replace(/±/g, '+/-').replace(/≤/g, '<=').replace(/≥/g, '>=')
      .replace(/\u00A0/g, ' ') // 替换不间断空格
      .replace(/&/g, '&') // 确保 & 符号正确
      .replace(/[ \t]+/g, ' ')
      .replace(/[\r\v\f]/g, '')
      .replace(/^["'“”d]+|["'“”e]+$/g, '') // 移除可能的垃圾前缀后缀如 "d "e
      .trim();
  };

  const cleanDescription = (text: string) => {
    if (!text) return "";
    return text
      .replace(/\*\*/g, '')
      .replace(/Description[:：]/i, '')
      .replace(/#{1,6}\s?/g, '')
      .replace(/`{1,3}/g, '')
      .replace(/^[ \t\n\*•-]+/gm, '')
      .replace(/\s+/g, ' ') 
      .replace(/\n{2,}/g, '\n\n')
      .replace(/([a-zA-Z])\s(?=[a-zA-Z]\s)/g, '$1') // 尝试修复 "s e c o n d" 问题：匹配 "字母+空格" 且后面跟着 "字母+空格"
      .trim();
  };

  const runSynthesis = async (pdfFile: File, assets: ManualAsset[]) => {
    const pageImages = await extractPagesAsImages(pdfFile);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const parts = [
      { text: `TASK: Extract Product Specs for RFecho.
      - productId, productName.
      - description (concise paragraph).
      - features (list).
      - imageBoxes (main, outline, curves).
      - Tables (specsTable, environmentalParams, absoluteMaxRatings).
      Return JSON.` }
    ];
    pageImages.forEach(img => parts.push({ inlineData: { mimeType: "image/jpeg", data: img.split(',')[1] } } as any));

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            productId: { type: Type.STRING },
            productName: { type: Type.STRING },
            description: { type: Type.STRING },
            features: { type: Type.ARRAY, items: { type: Type.STRING } },
            specsTable: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, headers: { type: Type.ARRAY, items: { type: Type.STRING } }, rows: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.STRING } } } } },
            environmentalParams: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, headers: { type: Type.ARRAY, items: { type: Type.STRING } }, rows: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.STRING } } } } },
            absoluteMaxRatings: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, headers: { type: Type.ARRAY, items: { type: Type.STRING } }, rows: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.STRING } } } } },
            imageBoxes: {
              type: Type.OBJECT,
              properties: {
                main: { type: Type.OBJECT, properties: { page: { type: Type.NUMBER }, box: { type: Type.ARRAY, items: { type: Type.NUMBER } } } },
                outline: { type: Type.OBJECT, properties: { page: { type: Type.NUMBER }, box: { type: Type.ARRAY, items: { type: Type.NUMBER } } } },
                curves: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { page: { type: Type.NUMBER }, box: { type: Type.ARRAY, items: { type: Type.NUMBER } } } } }
              }
            }
          },
          required: ["productId", "description", "features"]
        }
      }
    });

    const rawData: ExtractionResult = JSON.parse(response.text);

    // 1. 全局翻译处理 (确保 PDF 和 CSV 都是英文)
    const data = await translateObject(rawData, ai);

    // 2. 针对特定字段执行 NK -> OC 替换 (仅限 productId 和 productName)
    if (data.productId) data.productId = data.productId.replace(/NK/g, 'OC');
    if (data.productName) data.productName = data.productName.replace(/NK/g, 'OC');

    // 3. 应用手动指定的 ID 和 标题 (同样执行翻译和替换)
    if (manualProductId.trim()) {
      const translatedId = await translateToEnglish(manualProductId.trim(), ai);
      data.productId = translatedId.replace(/NK/g, 'OC');
    }
    if (manualProductTitle.trim()) {
      const translatedTitle = await translateToEnglish(manualProductTitle.trim(), ai);
      data.productName = translatedTitle.replace(/NK/g, 'OC');
    }

    // 顺序化处理 Base64 转换以防内存崩溃
    const processAssetsSequentially = async (role: AssetRole) => {
      const list = assets.filter(a => a.role === role);
      const results: string[] = [];
      for (const item of list) {
        results.push(await fileToBase64(item.file));
      }
      return results;
    };

    let finalMains = await processAssetsSequentially('main');
    let finalOutlines = await processAssetsSequentially('outline');
    let finalCurves = await processAssetsSequentially('curve');

    // 如果用户上传了任何图片，就不再从 pdf 中截取任何图片
    const hasManualAssets = assets.length > 0;

    if (!hasManualAssets) {
      // 补充裁剪图片
      if (finalMains.length === 0 && data.imageBoxes?.main) {
        const main = await cropImage(pageImages[data.imageBoxes.main.page - 1] || pageImages[0], data.imageBoxes.main.box);
        if (main) finalMains.push(main);
      }
      if (finalOutlines.length === 0 && data.imageBoxes?.outline) {
        const outline = await cropImage(pageImages[data.imageBoxes.outline.page - 1] || pageImages[0], data.imageBoxes.outline.box);
        if (outline) finalOutlines.push(outline);
      }
      if (finalCurves.length === 0 && data.imageBoxes?.curves) {
        for (const item of (data.imageBoxes.curves || [])) {
          const curve = await cropImage(pageImages[item.page - 1] || pageImages[0], item.box);
          if (curve) finalCurves.push(curve);
        }
      }
    }

    generateFinalPDF(data, finalMains, finalOutlines, finalCurves);
    generateCSV(data);
  };

  const generateCSV = (data: ExtractionResult) => {
    const baseHeaders = [
      "SKU", "Name", "short Description", "Description", "Features",
      "Applications", "Categories", "Images", "Outline", "Simulations"
    ];

    const rowData: Record<string, string> = {
      "SKU": sanitizeText(data.productId),
      "Name": sanitizeText(data.productName),
      "short Description": sanitizeText(data.features.join('\n')),
      "Description": cleanDescription(sanitizeText(data.description)),
      "Features": sanitizeText(data.features.join('\n')),
      "Applications": "",
      "Categories": "",
      "Images": "",
      "Outline": "",
      "Simulations": ""
    };

    const extraHeaders: string[] = [];

    const extractFromTable = (table?: TableData) => {
      if (!table || !table.rows) return;
      table.rows.forEach(row => {
        if (row.length >= 2) {
          const key = sanitizeText(row[0]);
          // Join remaining columns as the value
          const value = row.slice(1).map(sanitizeText).filter(v => v.trim() !== "").join(' ').trim();
          if (key && !baseHeaders.includes(key)) {
            rowData[key] = value;
            if (!extraHeaders.includes(key)) extraHeaders.push(key);
          }
        }
      });
    };

    extractFromTable(data.specsTable);
    extractFromTable(data.environmentalParams);
    extractFromTable(data.absoluteMaxRatings);

    const allHeaders = [...baseHeaders, ...extraHeaders];
    
    // CSV Escape function
    const escapeCSV = (val: string) => `"${val.replace(/"/g, '""')}"`;

    const csvContent = [
      allHeaders.map(escapeCSV).join(','),
      allHeaders.map(h => escapeCSV(rowData[h] || "")).join(',')
    ].join('\n');

    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${sanitizeText(data.productId || 'Datasheet')}_RFecho.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const startBatchProcess = async () => {
    if (!logo || !localStorage.getItem('top_png') || !bottomImg) {
      alert("Please upload brand assets first.");
      return;
    }
    setProcessing(true);
    const updatedQueue = [...batchQueue];
    for (let i = 0; i < updatedQueue.length; i++) {
      const item = updatedQueue[i];
      if (item.status === 'done') continue;
      updatedQueue[i] = { ...item, status: 'processing' };
      setBatchQueue([...updatedQueue]);
      setProgress(`Processing ${i + 1}/${updatedQueue.length}: ${item.pdf.name}`);
      try {
        await runSynthesis(item.pdf, item.assets);
        updatedQueue[i] = { ...item, status: 'done' };
      } catch (err: any) {
        updatedQueue[i] = { ...item, status: 'error', error: err.message };
      }
      setBatchQueue([...updatedQueue]);
    }
    setProcessing(false);
    setProgress("Batch Complete");
  };

  const processSingle = async (file: File) => {
    setProcessing(true);
    setProgress("Analyzing...");
    try {
      await runSynthesis(file, singleAssets);
      setProgress("Done");
    } catch (err) {
      alert("Process failed");
    } finally {
      setProcessing(false);
    }
  };

  const generateFinalPDF = (data: ExtractionResult, mainImgs: string[], outlineImgs: string[], curves: string[]) => {
    // @ts-ignore
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 18;

    const addHeaderFooter = () => {
      const hImg = localStorage.getItem('top_png');
      if (hImg) doc.addImage(hImg, 'PNG', 0, 0, pageWidth, 25);
      if (logo) {
        const props = doc.getImageProperties(logo);
        const ratio = props.width / props.height;
        const targetH = 13;
        const targetW = targetH * ratio;
        doc.addImage(logo, 'PNG', 10, 4, targetW, targetH);
      }
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text("Product Datasheet", pageWidth - margin, 11, { align: 'right' });
      doc.setFontSize(10);
      doc.setTextColor(194, 140, 45); 
      doc.setFont("helvetica", "bold");
      doc.text(`ID: ${sanitizeText(data.productId)}`, pageWidth - margin, 18, { align: 'right' });
      if (bottomImg) doc.addImage(bottomImg, 'PNG', 0, pageHeight - 18, pageWidth, 18);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(80, 80, 80);
      const fx = pageWidth - margin;
      const fstart = pageHeight - 12;
      doc.text("RFecho is trademark of Ocean Microwave", fx, fstart, { align: 'right' });
      doc.text("All rights reserved.", fx, fstart + 3.5, { align: 'right' });
      doc.text("©RFecho 2025", fx, fstart + 7, { align: 'right' });
      doc.text("www.rfecho.com", margin, pageHeight - 8);
    };

    const getImageDimensions = (imgBase64: string, maxW: number, maxH: number) => {
      const props = doc.getImageProperties(imgBase64);
      const ratio = props.width / props.height;
      let w = props.width * 0.264; let h = props.height * 0.264;
      if (w > maxW) { w = maxW; h = w / ratio; }
      if (h > maxH) { h = maxH; w = h * ratio; }
      return { w, h, ratio };
    };

    addHeaderFooter();
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    const titleText = data.productName || data.productId;
    const splitTitle = doc.splitTextToSize(sanitizeText(titleText), pageWidth - (margin * 2));
    doc.text(splitTitle, margin, 42);

    if (mainImgs.length > 0) {
      const areaY = 60;
      const areaMaxH = 95;
      const areaMaxW = pageWidth - (margin * 2);
      const count = mainImgs.length;
      if (count === 1) {
        const { w, h } = getImageDimensions(mainImgs[0], 130, areaMaxH);
        doc.addImage(mainImgs[0], 'PNG', (pageWidth - w) / 2, areaY + (areaMaxH - h) / 2, w, h);
      } else {
        const spacing = 10;
        const itemMaxW = (areaMaxW - spacing) / 2;
        const items = mainImgs.slice(0, 4);
        items.forEach((img, idx) => {
          const row = Math.floor(idx / 2);
          const col = idx % 2;
          const { w, h } = getImageDimensions(img, itemMaxW, areaMaxH / 2 - 5);
          const x = margin + col * (itemMaxW + spacing) + (itemMaxW - w) / 2;
          const y = areaY + row * (areaMaxH / 2 + 5) + (areaMaxH / 2 - h) / 2;
          doc.addImage(img, 'PNG', x, y, w, h);
        });
      }
    }

    const bY = 175; 
    const colGap = 12; 
    const colW = (pageWidth - (margin * 2) - colGap) / 2;
    
    doc.setFontSize(13); doc.setFont("helvetica", "bold"); doc.setTextColor(100, 100, 100);
    doc.text("Features", margin, bY); doc.text("Description", margin + colW + colGap, bY);

    // 核心改进：显式重置字体状态，确保字间距一致
    const resetBodyStyle = () => {
      doc.setFontSize(10); 
      doc.setFont("helvetica", "normal"); 
      doc.setTextColor(60, 60, 60);
      // @ts-ignore
      if(doc.setCharSpace) doc.setCharSpace(0); // 彻底重置字间距
    };

    resetBodyStyle();
    let featY = bY + 8;
    const maxFeatY = pageHeight - 25; // 预留底部空间
    
    (data.features || []).forEach(f => {
      if (featY > maxFeatY) return; // 防止超出页面
      const lines = doc.splitTextToSize(`• ${sanitizeText(f)}`, colW);
      if (featY + (lines.length * 5) > maxFeatY) return; // 如果这一条会超出，则跳过
      doc.text(lines, margin, featY, { align: 'left', lineHeightFactor: 1.3 });
      featY += (lines.length * 5) + 1.5; 
    });

    resetBodyStyle();
    const descText = cleanDescription(sanitizeText(data.description || ""));
    const descLines = doc.splitTextToSize(descText, colW);
    // 强制左对齐，严禁 justify
    doc.text(descLines, margin + colW + colGap, bY + 8, { align: 'left', lineHeightFactor: 1.35 });

    // --- 后续页面处理 ---
    doc.addPage(); addHeaderFooter();
    let currentY = 35;
    const renderTable = (table?: TableData, label?: string) => {
      if (!table || !table.rows || table.rows.length === 0) return;
      if (currentY > pageHeight - 55) { doc.addPage(); addHeaderFooter(); currentY = 35; }
      doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(40, 40, 40);
      doc.text(sanitizeText(table.title || label || ""), margin, currentY);
      // @ts-ignore
      doc.autoTable({
        startY: currentY + 4,
        head: [(table.headers || []).map(sanitizeText)],
        body: (table.rows || []).map(r => (r || []).map(sanitizeText)),
        theme: 'striped',
        headStyles: { fillColor: [50, 50, 50], textColor: 255, fontSize: 9, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8.5, textColor: 50 },
        margin: { left: margin, right: margin },
      });
      // @ts-ignore
      currentY = doc.lastAutoTable.finalY + 12;
    };
    renderTable(data.specsTable, "Electrical Parameters");
    renderTable(data.environmentalParams, "Environmental Specifications");
    renderTable(data.absoluteMaxRatings, "Absolute Maximum Ratings");

    // --- Combine all other images into "Product Image" section at the end ---
    const productImages = [...outlineImgs, ...curves];
    if (productImages.length > 0) {
      const footerReserved = 25; // 预留底部页脚空间
      const cGap = 8;
      const colWidth = (pageWidth - (margin * 2) - cGap) / 2;

      // 预计算第一张图片的高度，以决定是否需要整体换页
      const firstImgProps = doc.getImageProperties(productImages[0]);
      const firstAspect = firstImgProps.width / firstImgProps.height;
      const firstIsWide = firstAspect > 1.4;
      const firstTargetW = firstIsWide ? (pageWidth - margin * 2) : colWidth;
      let firstTargetH = firstTargetW / firstAspect;
      
      // 限制单张图最大高度（适配逻辑同下）
      const maxImgH = pageHeight - 35 - footerReserved;
      if (firstTargetH > maxImgH) firstTargetH = maxImgH;

      // 判断：标题(8mm) + 间距(2mm) + 第一张图高度 是否会超出当前页
      if (currentY + 8 + 2 + firstTargetH > pageHeight - footerReserved) {
        doc.addPage();
        addHeaderFooter();
        currentY = 35;
      }

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(40, 40, 40);
      doc.text("Product Image", margin, currentY);
      currentY += 8;
      
      let colIndex = 0; // 0 为左栏，1 为右栏
      let rowMaxH = 0;

      productImages.forEach((img, idx) => {
        const props = doc.getImageProperties(img);
        const aspect = props.width / props.height;
        
        // 判定是否为宽图
        const isWide = aspect > 1.4;

        // 如果当前在右栏，但下一张是宽图，必须先结束当前行
        if (colIndex === 1 && isWide) {
          currentY += rowMaxH + cGap;
          colIndex = 0;
          rowMaxH = 0;
        }

        let targetW, targetH;
        if (isWide) {
          targetW = pageWidth - margin * 2;
          targetH = targetW / aspect;
        } else {
          targetW = colWidth;
          targetH = targetW / aspect;
        }

        // 如果单张图片高度就超过了可用页面高度，则强制缩小以适应页面
        const maxAvailableH = pageHeight - 35 - footerReserved;
        if (targetH > maxAvailableH) {
          targetH = maxAvailableH;
          targetW = targetH * aspect;
        }

        // 检查是否需要换页
        if (currentY + targetH > pageHeight - footerReserved) {
          doc.addPage();
          addHeaderFooter();
          currentY = 35;
          colIndex = 0;
          rowMaxH = 0;
        }

        // 计算 X 坐标
        const xBase = (isWide || colIndex === 0) ? margin : (margin + colWidth + cGap);
        const availableW = isWide ? (pageWidth - margin * 2) : colWidth;
        const offsetX = (availableW - targetW) / 2; // 居中对齐
        
        try {
          doc.addImage(img, 'PNG', xBase + offsetX, currentY, targetW, targetH);
        } catch (e) {
          console.error("Image render error:", e);
        }

        // 更新坐标逻辑
        if (isWide) {
          currentY += targetH + cGap;
          colIndex = 0;
          rowMaxH = 0;
        } else {
          rowMaxH = Math.max(rowMaxH, targetH);
          if (colIndex === 1) {
            currentY += rowMaxH + cGap;
            colIndex = 0;
            rowMaxH = 0;
          } else {
            colIndex = 1;
            // 如果是最后一张图且在左栏，也要增加 Y
            if (idx === productImages.length - 1) {
              currentY += rowMaxH + cGap;
            }
          }
        }
      });
    }

    doc.save(`${sanitizeText(data.productId || 'Datasheet')}_RFecho.pdf`);
  };

  return (
    <div className="max-w-7xl mx-auto p-10 font-sans text-slate-900 bg-white min-h-screen">
      <header className="mb-14 flex justify-between items-center border-b pb-8 border-slate-100">
        <div className="flex-1">
          <h1 className="text-5xl font-black text-slate-900 tracking-tighter italic uppercase flex items-center">
            RFecho Builder 
            <span className="bg-emerald-500 text-white text-[10px] font-bold not-italic px-3 py-1 rounded-full ml-4 tracking-normal uppercase">Robust v6.6</span>
          </h1>
          <p className="text-slate-400 font-semibold mt-2 tracking-wide uppercase">Industrial Synthesis Engine</p>
        </div>
        <div className="flex items-center gap-4">
            <button onClick={() => setIsBatchMode(!isBatchMode)} className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${isBatchMode ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}`}>
                {isBatchMode ? 'Switch to Single Mode' : 'Switch to Bulk Mode'}
            </button>
            <StatusBadge label="Assets" active={!!logo && !!bottomImg} />
        </div>
      </header>
      
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-14">
        <div className="lg:col-span-4 space-y-8">
          <section className="bg-slate-50 p-8 rounded-[2rem] border border-slate-200 relative group">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Master Identity</h2>
              <button onClick={resetMasterIdentity} className="text-[9px] font-bold text-slate-400 hover:text-red-500 transition-colors uppercase tracking-tighter">Reset</button>
            </div>
            <AssetInput label="Logo" onChange={(e) => handlePersistentAsset(e, 'logo_png', setLogo)} active={!!logo} />
            <AssetInput label="Header Bg" onChange={(e) => handlePersistentAsset(e, 'top_png', () => {})} active={!!localStorage.getItem('top_png')} />
            <AssetInput label="Footer Bg" onChange={(e) => handlePersistentAsset(e, 'bottom_png', setBottomImg)} active={!!bottomImg} />
          </section>

          <section className="bg-slate-50 p-8 rounded-[2rem] border border-slate-200 relative">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Manual Override (Optional)</h2>
              <button onClick={resetManualOverride} className="text-[9px] font-bold text-slate-400 hover:text-red-500 transition-colors uppercase tracking-tighter">Clear</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1 tracking-widest">Product ID</label>
                <input 
                  type="text" 
                  value={manualProductId} 
                  onChange={(e) => setManualProductId(e.target.value)}
                  placeholder="e.g. RF-12345"
                  className="w-full text-[10px] border border-slate-200 rounded-xl p-2 bg-white focus:outline-none focus:border-slate-900"
                />
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1 tracking-widest">Main Title</label>
                <input 
                  type="text" 
                  value={manualProductTitle} 
                  onChange={(e) => setManualProductTitle(e.target.value)}
                  placeholder="e.g. High Power Amplifier"
                  className="w-full text-[10px] border border-slate-200 rounded-xl p-2 bg-white focus:outline-none focus:border-slate-900"
                />
              </div>
            </div>
          </section>

          {isBatchMode ? (
            <section className="bg-slate-50 p-8 rounded-[2rem] border border-slate-200">
              <h2 className="text-[10px] font-black mb-6 text-slate-400 uppercase tracking-widest">Bulk Sync</h2>
              <div className="space-y-4 mb-6">
                <label className="group block w-full py-6 px-4 bg-white border-2 border-dashed border-slate-200 rounded-3xl text-center cursor-pointer hover:border-slate-900 transition-all">
                    <span className="text-xs font-black text-slate-600 group-hover:text-slate-900 uppercase">1. Select PDF Folder</span>
                    <input type="file" {...({ webkitdirectory: "", directory: "" } as any)} multiple className="hidden" onChange={handlePdfFolderUpload} />
                </label>
                <label className="group block w-full py-6 px-4 bg-white border-2 border-dashed border-slate-200 rounded-3xl text-center cursor-pointer hover:border-amber-500 transition-all">
                    <span className="text-xs font-black text-slate-600 group-hover:text-amber-600 uppercase">2. Select Image Folder</span>
                    <input type="file" {...({ webkitdirectory: "", directory: "" } as any)} multiple className="hidden" onChange={handleImageFolderUpload} />
                </label>
              </div>
              <div className="max-h-[350px] overflow-y-auto space-y-3">
                {batchQueue.map(item => (
                  <div key={item.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                    <div className="min-w-0 pr-4">
                      <p className="text-[10px] font-black truncate text-slate-800 uppercase">{item.pdf.name}</p>
                      <p className="text-[8px] font-bold text-slate-400 truncate mt-0.5">{item.relativePath}</p>
                      <p className={`text-[9px] font-bold ${item.assets.length > 0 ? 'text-emerald-500' : 'text-slate-400'}`}>
                        {item.assets.length} Assets Found
                      </p>
                    </div>
                    <div className={`text-[8px] font-black uppercase px-2 py-1 rounded shrink-0 ${item.status === 'done' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                      {item.status}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
             <section className="bg-slate-50 p-8 rounded-[2rem] border border-slate-200 shadow-sm relative">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Single Match</h2>
                <button onClick={resetSingleMatch} className="text-[9px] font-bold text-slate-400 hover:text-red-500 transition-colors uppercase tracking-tighter">Reset</button>
              </div>
              <label className="group block w-full py-5 px-6 bg-white border-2 border-dashed border-slate-200 rounded-2xl text-center cursor-pointer hover:border-slate-900 transition-all mb-4">
                  <span className="text-xs font-black text-slate-600 group-hover:text-slate-900 uppercase">+ Add Assets</span>
                  <input type="file" multiple className="hidden" onChange={(e) => {
                    const files = Array.from(e.target.files || []) as File[];
                    setSingleAssets(prev => [...prev, ...files.map((f: File) => ({
                        id: Math.random().toString(36).substr(2, 9),
                        file: f,
                        preview: URL.createObjectURL(f),
                        role: f.name.toLowerCase().includes('main') ? 'main' : f.name.toLowerCase().includes('outline') ? 'outline' : 'curve'
                    } as ManualAsset))]);
                  }} />
              </label>
              <div className="max-h-[300px] overflow-y-auto space-y-2">
                {singleAssets.map(a => (
                  <div key={a.id} className="bg-white p-2 rounded-xl flex gap-3 items-center border border-slate-100">
                    <img src={a.preview} className="w-8 h-8 rounded object-cover" />
                    <select className="text-[9px] font-bold bg-slate-50 p-1 rounded" value={a.role} onChange={(e) => setSingleAssets(s => s.map(x => x.id === a.id ? {...x, role: e.target.value as any} : x))}>
                      <option value="main">Main Photo</option>
                      <option value="outline">Outline</option>
                      <option value="curve">Curve</option>
                    </select>
                  </div>
                ))}
              </div>
             </section>
          )}
        </div>

        <div className="lg:col-span-8">
          <section className="bg-slate-900 p-24 rounded-[4.5rem] shadow-2xl text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-slate-800 via-transparent to-transparent opacity-50"></div>
            <div className="relative z-10">
                <h2 className="text-6xl font-black mb-6 text-white tracking-tighter italic uppercase">
                  {isBatchMode ? 'Batch Core' : 'Reconstruct'}
                </h2>
                <p className="text-slate-400 mb-12 max-w-lg mx-auto text-sm font-medium leading-relaxed uppercase tracking-wide">
                  Memory optimized for high-volume assets. Automatic pagination handles complex data and unlimited curves.
                </p>
                {isBatchMode ? (
                  <button onClick={startBatchProcess} disabled={processing || batchQueue.length === 0} className={`inline-flex items-center justify-center px-16 py-7 rounded-3xl font-black text-xl transition-all transform hover:scale-[1.02] active:scale-95 shadow-2xl ${processing ? 'bg-slate-800 text-slate-500' : 'bg-white text-slate-900'}`}>
                    {processing ? progress : `START BATCH (${batchQueue.length})`}
                  </button>
                ) : (
                  <label className={`inline-flex items-center justify-center px-16 py-7 rounded-3xl font-black text-xl transition-all transform hover:scale-[1.02] active:scale-95 cursor-pointer shadow-2xl ${processing ? 'bg-slate-800 text-slate-500' : 'bg-white text-slate-900 hover:bg-slate-100'}`}>
                      {processing ? progress : 'ANALYZE & BUILD'}
                      <input type="file" accept=".pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) processSingle(file); }} disabled={processing} />
                  </label>
                )}
                {processing && (
                  <div className="mt-8 flex justify-center">
                    <div className="w-64 h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 animate-[shimmer_2s_infinite] w-full"></div>
                    </div>
                  </div>
                )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

const StatusBadge = ({ label, active }: { label: string; active: boolean }) => (
    <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${active ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-slate-300 border-slate-100'}`}>
        {label} {active ? 'CONFIGURED' : 'PENDING'}
    </div>
);

const AssetInput = ({ label, onChange, active }: { label: string; onChange: any; active: boolean }) => (
  <div className="mb-6 last:mb-0">
    <label className="text-[9px] font-black text-slate-400 uppercase flex justify-between mb-2 tracking-widest">
        {label} {active && <span className="text-emerald-500">READY</span>}
    </label>
    <input type="file" className="block w-full text-[10px] file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-slate-900 file:text-white border border-slate-200 rounded-2xl p-2 bg-white cursor-pointer" onChange={onChange} />
  </div>
);

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
