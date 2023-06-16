this file is pretty nonsensical right now
ill figure out a nicer way of doing things later:tm:

# idk buncha random stuff
```js
let chunks = new Map();
chunks.set(offset, chunk);




// Chunk buffer and offset buffer.
const chunkBuffer = device.createBuffer({
    label: "chunk storage buffer",
    size: 16*16*4, // 16x16 grid of u32s
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const chunkArray = new Uint32Array(16*16);
for (let y = 0; y < 16; ++y) {
    for (let x = 0; x < 16; ++x) {
        let offset = y*16 + x;
        let texture = Math.sqrt(x*x+(y-16)*(y-16)) % 9;
        chunkArray.set([texture], offset);
    }
}
device.queue.writeBuffer(chunkBuffer, 0, chunkArray);

const chunkOffsetBuffer = device.createBuffer({
    label: "chunk offset buffer",
    size: 2*4, // one vec2f
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(chunkOffsetBuffer, 0, new Int32Array([0, 0]));

// Another chunk buffer.
const anotherChunkBuffer = device.createBuffer({
    label: "another chunk storage buffer",
    size: 16*16*4, // 16x16 grid of u32s
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const anotherChunkArray = new Uint32Array(16*16);
for (let y = 0; y < 16; ++y) {
    for (let x = 0; x < 16; ++x) {
        let offset = y*16 + x;
        // let texture = Math.sqrt((x-32)*(x-32)+(y-16)*(y-16)) % 8;
        let texture = 2;
        anotherChunkArray.set([texture], offset);
    }
}
device.queue.writeBuffer(anotherChunkBuffer, 0, anotherChunkArray);

const anotherChunkOffsetBuffer = device.createBuffer({
    label: "another chunk offset buffer",
    size: 2*4, // one vec2f
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(anotherChunkOffsetBuffer, 0, new Int32Array([-1, 0]));


/// i kinda want to be able to determine the entire world generation like this

function at(x, y) {
    return Math.sqrt(x*x + y*y) % 9;
}



// Rendering.
function render() {

    // Command encoder, render pass.
    const encoder = device.createCommandEncoder({ label: 'encoder' });
    const pass = encoder.beginRenderPass({
        label: 'render pass',
        colorAttachments: [
            { // We're rendering to the canvas's current texture.
                view: context.getCurrentTexture().createView(),
                clearValue: [0.02, 0.05, 0.1, 1.0],
                loadOp: 'clear',
                storeOp: 'store',
            },
        ],
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setBindGroup(0, bindGroup);

    pass.setBindGroup(1, chunkBindGroup);
    pass.draw(4);

    pass.setBindGroup(1, anotherChunkBindGroup);
    pass.draw(4);

    pass.end();

    // We're done. Form a command buffer from `encoder`, and submit it.
    device.queue.submit([encoder.finish()]);
}

```

# ideally
```js
let chunks = {
    chunks: new Map(),
    chunkAt(chunkPos) {
        return chunks.
    }
}

```