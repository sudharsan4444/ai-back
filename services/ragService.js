const { Pinecone } = require('@pinecone-database/pinecone');
const fs = require('fs');
let pdf = require('pdf-parse');
if (typeof pdf !== 'function' && pdf.default) pdf = pdf.default;
const { getEmbedding } = require('./embeddingService');

const getPineconeClient = () => {
    const apiKey = (process.env.PINECONE_API_KEY || '').trim();
    if (!apiKey) {
        throw new Error("PINECONE_API_KEY is missing from environment.");
    }
    return new Pinecone({ apiKey });
};

const pinecone = getPineconeClient();

/**
 * Split text into meaningful chunks (paragraph-aware, ~800 chars each)
 */
const chunkText = (text, chunkSize = 1000) => {
    if (!text) return [];
    
    // Normalize whitespace
    const cleanText = text.replace(/\s+/g, ' ').trim();
    const chunks = [];
    
    for (let i = 0; i < cleanText.length; i += chunkSize - 100) {
        // Sliding window with overlap
        chunks.push(cleanText.slice(i, i + chunkSize));
    }

    return chunks;
};

/**
 * Upsert vectors in batches of 50 to stay within Pinecone limits
 */
const batchUpsert = async (index, vectors, batchSize = 50) => {
    for (let i = 0; i < vectors.length; i += batchSize) {
        const batch = vectors.slice(i, i + batchSize);
        const result = await index.upsert(batch);
        console.log(`  [RAG] Upserted batch ${Math.floor(i/batchSize)+1}/${Math.ceil(vectors.length/batchSize)} Response:`, JSON.stringify(result));
    }
};

// Resilient PDF text extraction
const extractText = async (dataBuffer) => {
    try {
        // Handle v1.x (original pdf-parse)
        if (typeof pdf === 'function') {
            const data = await pdf(dataBuffer);
            return data.text;
        }
        
        // Handle v2.x (Mehmet Kozan fork)
        // This assumes 'pdf-parse' might export a class named PDFParse in v2.x
        // If the global 'pdf' variable is already the v2 class, this will work.
        // Otherwise, we might need to conditionally require it.
        // For now, assuming 'pdf' itself might be the class or have a .PDFParse property.
        if (typeof pdf === 'object' && pdf.PDFParse) {
            const { PDFParse } = pdf; // Assuming pdf.PDFParse is the class
            const parser = new PDFParse({ data: dataBuffer });
            const result = await parser.getText();
            await parser.destroy();
            return result.text;
        } else if (typeof pdf === 'function' && pdf.name === 'PDFParse') { // If 'pdf' itself is the v2 class
            const parser = new pdf({ data: dataBuffer });
            const result = await parser.getText();
            await parser.destroy();
            return result.text;
        }
        
        throw new Error("pdf-parse is not a function and PDFParse class is not found");
    } catch (error) {
        console.error("[RAG] Text extraction failed:", error.message);
        throw error;
    }
};

const indexDocument = async (filePath, materialId) => {
    try {
        console.log(`[RAG] 📄 Starting indexing for material: ${materialId} (File: ${filePath})`);
        const dataBuffer = fs.readFileSync(filePath);
        const text = await extractText(dataBuffer);
        
        if (!text || text.trim().length === 0) {
            console.warn("[RAG] ⚠️ No text extracted from PDF. Possible scanned image or encrypted file.");
            return false; // Return false to indicate failure or no content
        }

        console.log(`[RAG] 📄 PDF Text Extracted: ${text.length} chars (First 100: ${text.substring(0, 100).replace(/\n/g, ' ')})`);
        // The original warning for empty text is now covered by the check above, but keeping it for consistency if text becomes empty later.
        if (text.trim().length === 0) {
            console.warn(`[RAG] ⚠️ PDF text is empty! Scanned or encrypted PDF?`);
        }

        const chunks = chunkText(text, 1000);
        console.log(`[RAG] 📄 Generated ${chunks.length} chunks from PDF`);

        const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
        const namespace = index.namespace(materialId.toString());
        const vectors = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (chunk.trim().length < 20) continue; 
            const embedding = await getEmbedding(chunk);
            vectors.push({
                id: `${materialId}-${i}`,
                values: embedding,
                metadata: {
                    text: chunk,
                    materialId: materialId.toString()
                }
            });
        }

        if (vectors.length > 0) {
            await batchUpsert(namespace, vectors, 50);
            console.log(`[RAG] ✅ Indexed ${vectors.length} vectors in namespace: ${materialId}`);
        } else {
            console.warn(`[RAG] ⚠️ No valid vectors generated for material: ${materialId}`);
        }

        return true;
    } catch (error) {
        console.error("[RAG] Error indexing document:", error);
        throw error;
    }
};

const queryContext = async (queryText, topK = 5, materialId = null) => {
    try {
        const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
        
        // Use namespace if materialId is provided, otherwise default
        const targetNamespace = materialId ? materialId.toString() : "";
        const indexNamespace = index.namespace(targetNamespace);

        console.log(`[RAG] 🔎 Preparing query (topK: ${topK}) in namespace: "${targetNamespace || 'default'}"`);
        
        const embedding = await getEmbedding(queryText);

        const queryOpts = {
            vector: embedding,
            topK: topK,
            includeMetadata: true
        };

        // If we choose NOT to use namespaces but use filter instead:
        // if (materialId) queryOpts.filter = { materialId: { "$eq": materialId.toString() } };
        
        console.log(`[RAG] 🔎 Querying Pinecone: "${queryText.substring(0, 50)}..."`);
        const queryResponse = await indexNamespace.query(queryOpts);
        
        console.log(`[RAG] 🔎 Pinecone Response: ${queryResponse.matches?.length || 0} matches found.`);
        
        // FALLBACK: If namespace query fails to find enough context, try global (default) namespace
        if ((!queryResponse.matches || queryResponse.matches.length === 0) && targetNamespace) {
            console.warn(`[RAG] ⚠️ No matches in namespace "${targetNamespace}". Trying default namespace...`);
            const fallbackResponse = await index.query(queryOpts);
            if (fallbackResponse.matches && fallbackResponse.matches.length > 0) {
                return fallbackResponse.matches.map(match => match.metadata?.text || "").join('\n\n');
            }
        }

        return queryResponse.matches.map(match => match.metadata?.text || "").join('\n\n');
    } catch (error) {
        console.error("[RAG] ❌ Error querying context:", error);
        return "";
    }
};

const deleteMaterialVectors = async (materialId) => {
    try {
        // 1. Wipe existing Pinecone vectors for this material
        console.log(`[RAG] Deleting vectors for material: ${materialId}`);
        const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
        
        // Use explicit $eq for safer filtering in Node SDK v2
        await index.deleteMany({
            filter: { materialId: { "$eq": materialId.toString() } }
        });
        
        console.log(`[RAG] ✅ Successfully deleted vectors for material: ${materialId}`);
        return true;
    } catch (error) {
        console.error("[RAG] ❌ Error deleting vectors from Pinecone:", error);
        // We don't throw here to avoid failing the DB deletion if Pinecone is down, 
        // but we log it clearly.
        return false;
    }
};

module.exports = {
    indexDocument,
    queryContext,
    deleteMaterialVectors
};
