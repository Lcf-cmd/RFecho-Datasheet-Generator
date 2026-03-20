# RFecho Datasheet Generator
A Node.js-based application that extracts information from PDF datasheets, processes the content (including text translation, special character replacement, and naming rule enforcement), and generates standardized PDF datasheets and corresponding CSV data files tailored for OC-series products (formerly NK-series).

## Features
### Core Functionality
1. **PDF Content Extraction**
   - Extract product information (title, ID, technical parameters, descriptions, features, images) from uploaded PDF datasheets
   - Smart image handling: Prioritize user-uploaded images over PDF-extracted images
2. **Content Processing**
   - NK → OC replacement (only for Product ID and PDF title fields, non-global)
   - Full English translation for all content (PDF & CSV) - auto-translates Chinese text/mixed Chinese-English text
   - Special character normalization:
     - `≤` → `<=`, `≥` → `>=`
     - `±` → `+/-`, `Ω` → `Ohm`, `℃` → `degC`
     - Removes garbage characters (e.g., `"d`, `"e`) and fixes spaced characters (e.g., `s e c o n d` → `second`)
3. **PDF Generation**
   - Custom layout with optimized content positioning
   - "Product Image" section placed intelligently (follows tables, auto-paginates when space is insufficient)
   - Responsive image layout (no overflow, proper spacing, natural scaling)
   - Removed "Mechanical Outline" and "Performance Data" sections
   - Prevents text overflow in "Features" section
4. **CSV Generation**
   - Auto-generated alongside PDF with standardized columns:
     - Mandatory: SKU (Product ID), Name (PDF title), short Description (copy of Features), Description, Features
     - Empty placeholder columns: Applications, Categories, Images, Outline, Simulations
     - Dynamic technical parameter columns (extracted from PDF tables)
   - UTF-8 BOM encoding for Excel compatibility
5. **User Controls**
   - Manual override for Product ID and Main Title (prioritized over PDF-extracted data)
   - Independent reset/clear buttons for:
     - Master Identity (brand assets)
     - Manual Override (ID/Title fields)
     - Single Match (uploaded images)

## Prerequisites
- Node.js (v16+ recommended)
- Gemini API Key (for content processing/translation)

## Installation & Usage
### 1. Clone the Repository
```bash
git clone https://github.com/your-username/rfecho-datasheet-generator.git
cd rfecho-datasheet-generator
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env.local` file in the root directory and add your Gemini API key:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 4. Run the Application
```bash
npm run dev
```

### 5. Using the App
1. Open the app in your browser (default: `http://localhost:3000` or as shown in terminal)
2. **Master Identity**: Upload brand assets (logo, header, footer) (optional)
3. **Manual Override (Optional)**: Enter custom Product ID/Title (will auto-translate Chinese to English)
4. **Single Match**: Upload a PDF datasheet and/or product images
5. Click "Analyze & Build" to generate:
   - A standardized PDF datasheet (OC-named, English-only, optimized layout)
   - A CSV file with extracted product data (full English, dynamic parameters)
6. Use reset/clear buttons to re-upload files/clear inputs as needed

## Customization Guide
### 1. Modify Naming Rules (NK → OC)
**File to edit**: `index.tsx`  
**Location**: Find the functions handling Product ID/Title sanitization (search for `NK`/`OC`).  
**How to change**:
- To modify the target fields: Adjust the logic to apply replacement to different fields (e.g., add Description field)
  ```typescript
  // Current logic (only Product ID/Title)
  const sanitizeProductId = (id: string) => id.replace(/NK/g, 'OC');
  const sanitizeTitle = (title: string) => title.replace(/NK/g, 'OC');

  // Modified logic (add Description)
  const sanitizeDescription = (desc: string) => desc.replace(/NK/g, 'OC');
  ```
- To change the replacement pair (e.g., OC → XYZ): Replace all `OC` with `XYZ` in the above functions

### 2. Adjust Special Character Replacement
**File to edit**: `index.tsx`  
**Location**: Find the `sanitizeText` function.  
**How to change**:
- Add new character mappings:
  ```typescript
  const sanitizeText = (text: string) => {
    return text
      .replace(/≤/g, '<=') // Existing
      .replace(/≥/g, '>=') // Existing
      .replace(/℃/g, 'degC') // Existing
      .replace(/µ/g, 'u') // New: add micro symbol replacement
      .replace(/乱码字符/g, 'replacement'); // Add custom mappings
  };
  ```
- Remove existing mappings: Delete the corresponding `.replace()` line

### 3. Modify PDF Layout
#### A. Add/Remove PDF Sections
**File to edit**: `index.tsx`  
**Location**: Find the PDF generation logic (search for `doc.text()`/`doc.addPage()`).  
**How to change**:
- To add a section (e.g., "Specifications"):
  ```typescript
  // Add after Features section
  doc.setFontSize(14);
  doc.text('Specifications', 20, currentY);
  currentY += 10;
  doc.setFontSize(10);
  doc.text(extractedSpecs, 20, currentY);
  currentY += 15;
  ```
- To remove a section: Delete the code block rendering the section (e.g., remove "Product Image" code to disable the section)

#### B. Adjust "Product Image" Layout
**File to edit**: `index.tsx`  
**Location**: Find the `renderProductImages` function.  
**How to change**:
- Modify image size limits (re-enable/disable scaling):
  ```typescript
  // Re-enable height limits (previously removed)
  const MAX_FULL_WIDTH_HEIGHT = 85; // mm
  const MAX_HALF_WIDTH_HEIGHT = 65; // mm

  // Apply limit to image height
  if (imageHeight > MAX_FULL_WIDTH_HEIGHT) {
    imageHeight = MAX_FULL_WIDTH_HEIGHT;
    imageWidth = (imageWidth / originalHeight) * MAX_FULL_WIDTH_HEIGHT;
  }
  ```
- Adjust spacing/margins:
  ```typescript
  // Change image gap (default: 10mm)
  const IMAGE_GAP = 15; // Increase gap to 15mm
  // Change page margin (default: 20mm)
  const PAGE_MARGIN = 25;
  ```
- Modify pagination logic: Adjust the `40mm` threshold in the space check:
  ```typescript
  // Current logic
  if (remainingHeight > 40) { // Render on current page
    renderImages();
  } else { // New page
    doc.addPage();
    renderImages();
  }

  // Modified threshold (e.g., 50mm)
  if (remainingHeight > 50) { ... }
  ```

### 4. Update CSV Columns
**File to edit**: `index.tsx`  
**Location**: Find the `generateCSV` function.  
**How to change**:
- Add a new column (e.g., "Warranty"):
  ```typescript
  // Add to column headers
  const headers = [
    'SKU', 'Name', 'short Description', 'Description', 'Features',
    'Applications', 'Categories', 'Images', 'Outline', 'Simulations',
    'Warranty', // New column
    ...parameterColumns // Dynamic parameters
  ];

  // Populate data for the new column
  const row = [
    productId,
    productTitle,
    shortDescription,
    description,
    features,
    '', // Applications (empty)
    '', // Categories (empty)
    '', // Images (empty)
    '', // Outline (empty)
    '', // Simulations (empty)
    '1 Year', // Warranty value (customize as needed)
    ...parameterValues
  ];
  ```
- Remove a column: Delete the entry from the `headers` array and corresponding value from the `row` array
- Modify empty columns: Change the empty string (`''`) to a default value (e.g., `'N/A'` for Applications)

### 5. Adjust Translation Logic
**File to edit**: `index.tsx`  
**Location**: Find the translation function (search for `Gemini`/`translateToEnglish`).  
**How to change**:
- Exclude fields from translation:
  ```typescript
  // Current logic (translate all fields)
  const translateAll = async (data: any) => {
    data.description = await translateToEnglish(data.description);
    data.features = await translateToEnglish(data.features);
    data.parameters = await translateToEnglish(data.parameters);
    return data;
  };

  // Modified logic (exclude parameters)
  const translateAll = async (data: any) => {
    data.description = await translateToEnglish(data.description);
    data.features = await translateToEnglish(data.features);
    // Remove parameters translation
    return data;
  };
  ```
- Change translation language (if supported by Gemini): Modify the prompt in `translateToEnglish`:
  ```typescript
  const translateToEnglish = async (text: string) => {
    // Current prompt
    const prompt = `Translate this technical product text to professional English: ${text}`;
    // Modified prompt (e.g., translate to German)
    const prompt = `Translate this technical product text to professional German: ${text}`;
    // Call Gemini API with new prompt
  };
  ```

### 6. Modify CSV/PDF Output
**File to edit**: `index.tsx`  
**Location**: Find the download logic (search for `blob`/`saveAs`).  
**How to change**:
- Rename output files:
  ```typescript
  // Current (PDF)
  saveAs(pdfBlob, `${productId}_datasheet.pdf`);
  // Modified
  saveAs(pdfBlob, `${productId}_OC_datasheet_v2.pdf`);

  // Current (CSV)
  saveAs(csvBlob, `${productId}_data.csv`);
  // Modified
  saveAs(csvBlob, `${productId}_OC_product_data.csv`);
  ```
- Change CSV encoding: Modify the BOM/header logic (not recommended unless necessary):
  ```typescript
  // Current (UTF-8 BOM)
  const csvContent = '\ufeff' + headers.join(',') + '\n' + row.join(',');
  // Modified (UTF-8 no BOM)
  const csvContent = headers.join(',') + '\n' + row.join(',');
  ```

## Troubleshooting
### 1. PDF Table Garbled Text
- Ensure the `sanitizeText` function in `index.tsx` includes all special character mappings (e.g., `Ω` → `Ohm`)
- Verify all Chinese text is translated to English (check the `translateAll` function)

### 2. Image Overflow/Overlap
- Adjust image height limits in the `renderProductImages` function
- Check the spacing/gap values (increase if images overlap)

### 3. CSV Not Opening Correctly in Excel
- Ensure the CSV includes the UTF-8 BOM (`\ufeff` at the start of the content)
- Verify no commas exist in the text (the app should escape commas; if not, add:
  ```typescript
  const escapeCommas = (text: string) => text.replace(/,/g, ';');
  // Apply to all CSV fields
  const row = [escapeCommas(productId), escapeCommas(productTitle), ...];
  ```

### 4. Gemini API Errors
- Check `.env.local` for a valid API key
- Ensure the PDF file size is under 52MB (Gemini's limit) - compress large PDFs before upload

## License
This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments
- Uses `jsPDF` for PDF generation
- Uses `papaparse` for CSV handling
- Powered by Google Gemini API for content processing/translation
