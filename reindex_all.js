require('dotenv').config();
console.log('Loading dependencies...');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
console.log('Loading models and services...');
const Material = require('./models/Material');
const { indexDocument, deleteMaterialVectors } = require('./services/ragService');

async function reindexAll() {
    try {
        console.log('--- RE-INDEXING ALL PDF MATERIALS ---');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        const materials = await Material.find({ type: 'PDF' });
        console.log(`Found ${materials.length} PDF materials to process.`);

        for (const material of materials) {
            try {
                console.log(`\n[${material.title}] Processing (${material._id})...`);
                
                const filename = material.url.replace('/uploads/', '');
                const filePath = path.join(__dirname, 'uploads', filename);

                if (fs.existsSync(filePath)) {
                    console.log(`[${material.title}] File found: ${filePath}`);
                    
                    console.log(`[${material.title}] Clearing old vectors...`);
                    try {
                        await deleteMaterialVectors(material._id);
                    } catch (delErr) {
                        console.warn(`[${material.title}] ⚠️ Deletion warning (continuing):`, delErr.message);
                    }

                    console.log(`[${material.title}] Indexing...`);
                    await indexDocument(filePath, material._id);
                    console.log(`[${material.title}] ✅ Successfully re-indexed.`);
                } else {
                    console.warn(`[${material.title}] ❌ File NOT found at ${filePath}. Skipping.`);
                }
            } catch (itemErr) {
                console.error(`[${material.title}] 💥 Failed to re-index material:`, itemErr.message);
                if (itemErr.stack) console.error(itemErr.stack);
            }
        }

        console.log('\n--- RE-INDEXING COMPLETE ---');
        process.exit(0);
    } catch (err) {
        console.error('💥 Critical Error during re-indexing:', err);
        process.exit(1);
    }
}

reindexAll();
