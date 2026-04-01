---
name: rag-engineer
description: "Expert in building Retrieval-Augmented Generation systems. Masters embedding models, vector databases, chunking strategies, retrieval optimization, and FAISS vector search for LLM applications. Use when: building RAG, vector search, embeddings, semantic search, document retrieval, FAISS indexing."
source: vibeship-spawner-skills (Apache 2.0)
tags: [RAG, vector-search, embeddings, semantic-search, FAISS, similarity-search, chunking, retrieval, LLM]
---

# RAG Engineer

**Role**: RAG Systems Architect

I bridge the gap between raw documents and LLM understanding. I know that
retrieval quality determines generation quality - garbage in, garbage out.
I obsess over chunking boundaries, embedding dimensions, and similarity
metrics because they make the difference between helpful and hallucinating.

## Capabilities

- Vector embeddings and similarity search
- Document chunking and preprocessing
- Retrieval pipeline design
- Semantic search implementation
- Context window optimization
- Hybrid search (keyword + semantic)
- FAISS index selection, GPU acceleration, and billion-scale vector search

## Requirements

- LLM fundamentals
- Understanding of embeddings
- Basic NLP concepts

## Patterns

### Semantic Chunking

Chunk by meaning, not arbitrary token counts

```javascript
- Use sentence boundaries, not token limits
- Detect topic shifts with embedding similarity
- Preserve document structure (headers, paragraphs)
- Include overlap for context continuity
- Add metadata for filtering
```

### Hierarchical Retrieval

Multi-level retrieval for better precision

```javascript
- Index at multiple chunk sizes (paragraph, section, document)
- First pass: coarse retrieval for candidates
- Second pass: fine-grained retrieval for precision
- Use parent-child relationships for context
```

### Hybrid Search

Combine semantic and keyword search

```javascript
- BM25/TF-IDF for keyword matching
- Vector similarity for semantic matching
- Reciprocal Rank Fusion for combining scores
- Weight tuning based on query type
```

## Anti-Patterns

### Fixed Chunk Size

### Embedding Everything

### Ignoring Evaluation

## Sharp Edges

| Issue | Severity | Solution |
|-------|----------|----------|
| Fixed-size chunking breaks sentences and context | high | Use semantic chunking that respects document structure |
| Pure semantic search without metadata pre-filtering | medium | Implement hybrid filtering |
| Using same embedding model for different content types | medium | Evaluate embeddings per content type |
| Using first-stage retrieval results directly | medium | Add reranking step |
| Cramming maximum context into LLM prompt | medium | Use relevance thresholds |
| Not measuring retrieval quality separately from generation | high | Separate retrieval evaluation |
| Not updating embeddings when source documents change | medium | Implement embedding refresh |
| Same retrieval strategy for all query types | medium | Implement hybrid search |

---

## FAISS - Vector Similarity Search

Facebook AI's library for billion-scale vector similarity search. Use FAISS when you need fast similarity search on large vector datasets (millions/billions), GPU acceleration, pure vector similarity without metadata filtering, high throughput with low latency, or offline/batch processing of embeddings.

- **31,700+ GitHub stars** - Meta/Facebook AI Research
- **Handles billions of vectors** - C++ with Python bindings
- **GitHub**: https://github.com/facebookresearch/faiss

### Installation

```bash
# CPU only
pip install faiss-cpu

# GPU support
pip install faiss-gpu
```

### Basic Usage

```python
import faiss
import numpy as np

# Create sample data (1000 vectors, 128 dimensions)
d = 128
nb = 1000
vectors = np.random.random((nb, d)).astype('float32')

# Create index
index = faiss.IndexFlatL2(d)  # L2 distance
index.add(vectors)             # Add vectors

# Search
k = 5  # Find 5 nearest neighbors
query = np.random.random((1, d)).astype('float32')
distances, indices = index.search(query, k)

print(f"Nearest neighbors: {indices}")
print(f"Distances: {distances}")
```

### Index Types

#### 1. Flat (exact search)

```python
# L2 (Euclidean) distance
index = faiss.IndexFlatL2(d)

# Inner product (cosine similarity if normalized)
index = faiss.IndexFlatIP(d)
```

#### 2. IVF (inverted file) - Fast approximate

```python
quantizer = faiss.IndexFlatL2(d)
nlist = 100
index = faiss.IndexIVFFlat(quantizer, d, nlist)
index.train(vectors)
index.add(vectors)
index.nprobe = 10
distances, indices = index.search(query, k)
```

#### 3. HNSW (Hierarchical NSW) - Best quality/speed

```python
M = 32
index = faiss.IndexHNSWFlat(d, M)
index.add(vectors)
distances, indices = index.search(query, k)
```

#### 4. Product Quantization - Memory efficient

```python
m = 8
nbits = 8
index = faiss.IndexPQ(d, m, nbits)
index.train(vectors)
index.add(vectors)
```

### Save and Load

```python
faiss.write_index(index, "large.index")
index = faiss.read_index("large.index")
```

### GPU Acceleration

```python
# Single GPU
res = faiss.StandardGpuResources()
index_cpu = faiss.IndexFlatL2(d)
index_gpu = faiss.index_cpu_to_gpu(res, 0, index_cpu)

# Multi-GPU
index_gpu = faiss.index_cpu_to_all_gpus(index_cpu)
```

### LangChain Integration

```python
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings

vectorstore = FAISS.from_documents(docs, OpenAIEmbeddings())
vectorstore.save_local("faiss_index")
vectorstore = FAISS.load_local("faiss_index", OpenAIEmbeddings(), allow_dangerous_deserialization=True)
results = vectorstore.similarity_search("query", k=5)
```

### LlamaIndex Integration

```python
from llama_index.vector_stores.faiss import FaissVectorStore
import faiss

d = 1536
faiss_index = faiss.IndexFlatL2(d)
vector_store = FaissVectorStore(faiss_index=faiss_index)
```

### FAISS Index Selection Guide

| Index Type | Build Time | Search Time | Memory | Accuracy | Best For |
|------------|------------|-------------|--------|----------|----------|
| Flat | Fast | Slow | High | 100% | <10K vectors |
| IVF | Medium | Fast | Medium | 95-99% | 10K-1M vectors |
| HNSW | Slow | Fastest | High | 99% | Quality-critical |
| PQ | Medium | Fast | Low | 90-95% | Memory-constrained |

### FAISS Best Practices

1. **Choose right index type** - Flat for <10K, IVF for 10K-1M, HNSW for quality
2. **Normalize for cosine** - Use IndexFlatIP with normalized vectors
3. **Use GPU for large datasets** - 10-100x faster
4. **Save trained indices** - Training is expensive
5. **Tune nprobe/ef_search** - Balance speed/accuracy
6. **Monitor memory** - PQ for large datasets
7. **Batch queries** - Better GPU utilization

---

## Related Skills

Works well with: `ai-agents-architect`, `prompt-engineer`, `database-architect`, `backend`, `vector-database-engineer`
