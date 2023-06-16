let chunks = {
    chunks: new Map(),

    get(pos) {
        if (!this.chunks.has(pos)) this.chunks.set(pos, createChunk(pos));

        let chunk = this.chunks.get(pos);
        return chunk;
    },

    createChunk(pos) {
        let chunk = {
            pos,
            posBuffer: device.createBuffer({
                label: `chunk (${this.pos[0]}, ${this.pos[1]}) position uniform buffer`,
                size: 2*4, // one vec2f
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }),

            array: new Uint32Array(16*16),
            buffer: device.createBuffer({
                label: `chunk (${this.pos[0]}, ${this.pos[1]}) storage buffer`,
                size: 16*16*4, // 16x16 grid of u32s
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),

            bindGroup: device.createBindGroup({
                label: `chunk (${this.pos[0]}, ${this.pos[1]}) bind group`,
                layout: pipeline.getBindGroupLayout(1),
                entries: [
                    {binding: 0, resource: {buffer: this.buffer}},
                    {binding: 1, resource: {buffer: this.coordinateBuffer}},
                ],
            }),
        };

        for (let y = 0; y < 16; ++y) {
            for (let x = 0; x < 16; ++x) {
                let offset = y*16 + x;
                let texture = Math.sqrt(x*x+(y-16)*(y-16)) % 9;
                chunk.array.set([texture], offset);
            }
        }

        device.queue.writeBuffer(chunk.buffer, 0, chunk.array);
        device.queue.writeBuffer(chunk.posBuffer, 0, chunk.pos);

        return chunk;
    },
};