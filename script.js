// TODO: there's some really weird texture bleeding(??) going on??
// *specifically* when i nudge the chunk down by like. 1.6 pixels.
// Then there's an extra row of garbage pixels at the very top
//
// im not sure why it's happening but im way too tired tonight to bother figuring it out lol
//
// it's definitely due to some floating point magic, though.
// maybe due to the fact that, there's a Lotta mingling of u32's AND f32's in the fragment shader?
// maybe it's because [one of the coordinate systems im using] is centered on 0.0, 0.0, instead of 0.5, 0.5(??)
//
// i dont know. that's just me throwing stuff at the wall. it's for future me to figure out.

// ALSO TODO:
// make sure both chunks get rendered, rn they're perfectly superimposed on top of each other lol

async function fetchText(url) {
    const response = await fetch(url);
    const text = await response.text();
    return text;
}

async function main() {

    // Adapter, device.
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) throw new Error('need a browser that supports WebGPU');



    // Canvas and WebGPU context.
    const canvas = document.querySelector('canvas');
    const pixel_scale = 4;
    canvas.width  = canvas.clientWidth / pixel_scale;
    canvas.height = canvas.clientHeight / pixel_scale;

    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: canvasFormat,
    });



    // Chunk rendering shader.
    const wgsl = await fetchText('/shader.wgsl');
    const module = device.createShaderModule({
        label: "chunk shader",
        code: wgsl,
    });



    // Pipeline.
    const pipeline = device.createRenderPipeline({
        label: "chunk rendering pipeline",
        layout: 'auto',
        primitive: { topology: "triangle-strip" },
        vertex: {
            module,
            entryPoint: 'main_vertex',
            buffers: [{
                arrayStride: 2*4,
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: 'float32x2'
                }]
            }],
        },
        fragment: {
            module,
            entryPoint: 'main_fragment',
            targets: [{ format: canvasFormat }],
        },
    });



    // ...Buffers.
    // Vertex buffer.
    const vertexBuffer = device.createBuffer({
        label: "vertex buffer",
        size: 2*4*4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
        vertexBuffer, 0,
        new Float32Array([
            0, 0,
            0, 128,
            128, 0,
            128, 128,
        ])
    );

    // Atlas .png file and sampler.
    const atlasElement = document.querySelector("img");
    const source = await createImageBitmap(atlasElement, { colorSpaceConversion: "none" });
    const texture = device.createTexture({
        label: "atlas texture",
        format: 'rgba8unorm',
        size: [source.width, source.height],
        usage: GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
        { source, flipY: false },
        { texture },
        { width: source.width, height: source.height },
    );

    const sampler = device.createSampler({
        magFilter: 'nearest',
    });

    // Atlas size buffer.
    const atlasSizeBuffer = device.createBuffer({
        label: "atlas size uniform",
        size: 2*4, // one vec2u
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(atlasSizeBuffer, 0, new Uint32Array([3, 3]));

    // Resolution buffer.
    const resolutionBuffer = device.createBuffer({
        label: "canvas resolution uniform",
        size: 2*4, // one vec2f
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
        resolutionBuffer, 0,
        new Float32Array([canvas.width, canvas.height])
    );

    // Camera buffer.
    const cameraBuffer = device.createBuffer({
        label: "camera uniform",
        size: 2*4, // one vec2f
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(cameraBuffer, 0, new Float32Array([0, 0]));



    // Chunks.
    let chunks = {
        chunks: new Map(),

        get(pos) {
            if (!this.chunks.has(pos)) this.chunks.set(pos, this.createChunk(pos));

            let chunk = this.chunks.get(pos);
            return chunk;
        },

        createChunk(pos) {
            let posBuffer = device.createBuffer({
                label: `chunk (${pos[0]}, ${pos[1]}) position uniform buffer`,
                size: 2*4, // one vec2f
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            let buffer = device.createBuffer({
                label: `chunk (${pos[0]}, ${pos[1]}) storage buffer`,
                size: 16*16*4, // 16x16 grid of u32s
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });

            let bindGroup = device.createBindGroup({
                label: `chunk (${pos[0]}, ${pos[1]}) bind group`,
                layout: pipeline.getBindGroupLayout(1),
                entries: [
                    {binding: 0, resource: {buffer: buffer}},
                    {binding: 1, resource: {buffer: posBuffer}},
                ],
            });

            let chunk = {
                pos,
                posBuffer,
                array: new Uint32Array(16*16),
                buffer,
                bindGroup,
            };

            for (let y = 0; y < 16; ++y) {
                for (let x = 0; x < 16; ++x) {
                    let offset = y*16 + x;
                    let texture = Math.sqrt(x*x+(y-16)*(y-16)) % 4 + 4;
                    chunk.array.set([texture], offset);
                }
            }

            device.queue.writeBuffer(chunk.buffer, 0, chunk.array);
            device.queue.writeBuffer(chunk.posBuffer, 0, new Int32Array(chunk.pos));

            return chunk;
        },
    };



    // Bind group.
    const bindGroup = device.createBindGroup({
        label: "bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {binding: 0, resource: texture.createView()},
            {binding: 1, resource: sampler},
            {binding: 2, resource: {buffer: atlasSizeBuffer}},
            {binding: 3, resource: {buffer: resolutionBuffer}},
            {binding: 4, resource: {buffer: cameraBuffer}},
        ]
    });



    // Rendering.
    function render() {

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

        for (let i = -2; i <= 2; ++i) {
            pass.setBindGroup(1, chunks.get([0, i]).bindGroup);
            pass.draw(4);
        }

        pass.end();

        // We're done. Form a command buffer from `encoder`, and submit it.
        device.queue.submit([encoder.finish()]);
    }



    // Controls
    let up = false;
    let left = false;
    let down = false;
    let right = false;

    let in_ = false;
    let out = false;

    window.addEventListener("keydown", function(e) {
        switch (e.key.toLowerCase()) {
            case "w": up    = true; break;
            case "a": left  = true; break;
            case "s": down  = true; break;
            case "d": right = true; break;

            case "shift": in_ = true; break;
            case " ":     out = true; break;
        }
    });

    window.addEventListener("keyup", function(e) {
        switch (e.key.toLowerCase()) {
            case "w": up    = false; break;
            case "a": left  = false; break;
            case "s": down  = false; break;
            case "d": right = false; break;

            case "shift": in_ = false; break;
            case " ":     out = false; break;
        }
    });

    window.addEventListener("blur", function(e) {
        up    = false;
        left  = false;
        down  = false;
        right = false;

        in_ = false;
        out = false;
    });

    let frame = 0;
    let camera = {
        x: 0,
        y: 0,
        focus_x: 0,
        focus_y: 0,
        array: new Float32Array([this.x, this.y]),

        update() {
            if (up)    this.focus_y += 6;
            if (down)  this.focus_y -= 6;
            if (left)  this.focus_x -= 6;
            if (right) this.focus_x += 6;

            this.x += (this.focus_x - this.x) * 0.1;
            this.y += (this.focus_y - this.y) * 0.1;

            this.array.set([this.x, this.y], 0);
            device.queue.writeBuffer(cameraBuffer, 0, this.array);
        }
    }

    function update() {
        camera.update();
        document.querySelector('p').innerText = `${frame} / (${camera.focus_x}, ${camera.focus_y})`;
        ++frame;
    }



    // Loop.
    function loop() {
        update();
        render();
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}



window.addEventListener("mouseup", function(e) {
    e.preventDefault();
});

main().catch(err => console.error(err));