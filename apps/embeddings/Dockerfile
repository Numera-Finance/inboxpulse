# Embedding service: Ollama with nomic-embed-text baked into the image.
#
# Ollama rather than a lighter ONNX runtime, and that is the whole design
# decision. Every one of the 35,507 training vectors and every coefficient in
# berne-whiskers.json came from `ollama run nomic-embed-text`. A different
# implementation of the same model — transformers.js, sentence-transformers,
# Vertex — can differ in pooling, in normalisation, or in whether it silently
# prepends a task prefix, and the result is still 768 plausible numbers. There
# would be no error, only a gate that has quietly stopped meaning what it was
# trained to mean.
#
# So the service runs the same binary that produced the corpus. The image is
# larger and the cold start is slower; both are cheaper than an unfalsifiable
# scoring bug.

# Pinned, not :latest. The corpus was embedded with 0.32.9; a future Ollama that
# changes pooling or default parameters would produce vectors that no longer sit
# in the same space as the 35,507 already stored, and nothing would report an
# error.
FROM ollama/ollama:0.32.9

# Bake the model in. Pulling at boot would make the first request after every
# cold start wait on a 274 MB download, and would fail entirely if the registry
# were unreachable — a dependency this service has no reason to keep at runtime.
RUN ollama serve & \
    sleep 6 && \
    ollama pull nomic-embed-text && \
    pkill ollama

ENV OLLAMA_HOST=0.0.0.0:8080
ENV OLLAMA_KEEP_ALIVE=-1
ENV OLLAMA_NUM_PARALLEL=4

EXPOSE 8080
ENTRYPOINT []
CMD ["ollama", "serve"]
