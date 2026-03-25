const { pipeline } = require('@xenova/transformers');

let embeddingPipeline = null;

/**
 * Generates an embedding for the given text using local Transformers.js model.
 * Produces 384 dimensions. Ensure Pinecone index matches this.
 */
const getEmbedding = async (text) => {
    if (!embeddingPipeline) {
        console.log('Loading local embedding model (Transformers.js)...');
        embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }

    const output = await embeddingPipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
};

module.exports = {
    getEmbedding
};
