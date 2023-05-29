async function fetchText(url) {
    const response = await fetch(url);
    const text = await response.text();
    return text;
}

async function main() {

    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) throw new Error('need a browser that supports WebGPU');

    const canvas = document.querySelector('canvas');
    const zoom = 16;
    canvas.width  = canvas.clientWidth  / zoom;
    canvas.height = canvas.clientHeight / zoom;

    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: canvasFormat,
    });



    // General shader stuff.
    const lineShader = device.createShaderModule({ label: "line shader", code: await fetchText('line.wgsl') });
    const trailShader = device.createShaderModule({ label: "trail shader", code: await fetchText('trail.wgsl') });
    const finalShader = device.createShaderModule({ label: "final shader", code: await fetchText('final.wgsl') });

    const canvasVertexBuffer = device.createBuffer({
        label: "canvas vertex buffer",
        size: 4*2*4, // vec2f
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
        canvasVertexBuffer, 0,
        new Float32Array([
            -1, 1,
            -1, -1,
            1, 1,
            1, -1,
        ]),
    );

    const resolutionUniform = device.createBuffer({
        label: "resolution uniform",
        size: 2*4, // vec2f
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(resolutionUniform, 0, new Float32Array([canvas.width, canvas.height]));

    const sampler = device.createSampler({ label: "sampler" })



    // Line shader stuff.
    const linePipeline = device.createRenderPipeline({
        label: "line render pipeline",
        layout: 'auto',
        primitive: { topology: 'line-list' },
        vertex: {
            module: lineShader,
            entryPoint: "main_vertex",
            buffers: [{
                arrayStride: 2*4,
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: "float32x2",
                }],
            }],
        },
        fragment: {
            module: lineShader,
            entryPoint: "main_fragment",
            targets: [{ format: canvasFormat }],
        }
    });

    const lineFrame = device.createTexture({
        label: "line frame",
        format: canvasFormat,
        size: [canvas.width, canvas.height],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
    });

    const lineVertexBuffer = device.createBuffer({
        label: "line vertex buffer",
        size: 2*2*4, // 2 x vec2f
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    const lineBindGroup = device.createBindGroup({
        label: "line shader bind group",
        layout: linePipeline.getBindGroupLayout(0),
        entries: [
            {binding: 0, resource: {buffer: resolutionUniform}},
        ],
    });

    const lineRenderDesc = {
        label: "line renderer",
        colorAttachments: [{
            view: null,
            clearValue: [0.0, 0.0, 0.0, 0.0],
            loadOp: "clear",
            storeOp: "store",
        }],
    };



    // Trail shader stuff.
    const trailPipeline = device.createRenderPipeline({
        label: "trail render pipeline",
        layout: 'auto',
        primitive: { topology: 'triangle-strip' },
        vertex: {
            module: trailShader,
            entryPoint: "main_vertex",
            buffers: [{
                arrayStride: 2*4,
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: "float32x2",
                }],
            }],
        },
        fragment: {
            module: trailShader,
            entryPoint: "main_fragment",
            targets: [{ format: canvasFormat }],
        }
    });

    const trailFrame = device.createTexture({
        label: "trail frame",
        format: canvasFormat,
        size: [canvas.width, canvas.height],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
    });

    const prevFrame = device.createTexture({
        label: "previous trail frame",
        format: canvasFormat,
        size: [canvas.width, canvas.height],
        usage: GPUTextureUsage.RENDER_ATTACHMENT |
               GPUTextureUsage.COPY_SRC |
               GPUTextureUsage.COPY_DST |
               GPUTextureUsage.TEXTURE_BINDING,
    });

    const trailBindGroup = device.createBindGroup({
        label: "trail bind group",
        layout: trailPipeline.getBindGroupLayout(0),
        entries: [
            {binding: 0, resource: {buffer: resolutionUniform}},
            {binding: 1, resource: sampler},
            {binding: 2, resource: lineFrame.createView()},
            {binding: 3, resource: prevFrame.createView()},
        ],
    });

    const trailRenderDesc = {
        label: "trail renderer",
        colorAttachments: [{
            view: null,
            clearValue: [0.0, 0.0, 0.0, 0.0],
            loadOp: "clear",
            storeOp: "store",
        }],
    };



    // Final shader stuff.
    const finalPipeline = device.createRenderPipeline({
        label: "final render pipeline",
        layout: 'auto',
        primitive: { topology: 'triangle-strip' },
        vertex: {
            module: finalShader,
            entryPoint: "main_vertex",
            buffers: [{
                arrayStride: 2*4,
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: "float32x2",
                }],
            }],
        },
        fragment: {
            module: finalShader,
            entryPoint: "main_fragment",
            targets: [{ format: canvasFormat }],
        }
    });

    const finalBindGroup = device.createBindGroup({
        label: "final bind group",
        layout: finalPipeline.getBindGroupLayout(0),
        entries: [
            {binding: 0, resource: {buffer: resolutionUniform}},
            {binding: 1, resource: sampler},
            {binding: 2, resource: trailFrame.createView()},
        ],
    });

    const finalRenderDesc = {
        label: "final renderer",
        colorAttachments: [{
            view: null,
            clearValue: [0.0, 0.0, 0.0, 0.0],
            loadOp: "clear",
            storeOp: "store",
        }],
    };



    // Rendering.
    function render() {
        const encoder = device.createCommandEncoder();

        // Line render.
        lineRenderDesc.colorAttachments[0].view = lineFrame.createView();
        // lineRenderDesc.colorAttachments[0].view = context.getCurrentTexture().createView();
        const linePass = encoder.beginRenderPass(lineRenderDesc);
        linePass.setPipeline(linePipeline);
        linePass.setVertexBuffer(0, lineVertexBuffer);
        linePass.setBindGroup(0, lineBindGroup);
        linePass.draw(2);
        linePass.end();

        // Trail render.
        trailRenderDesc.colorAttachments[0].view = trailFrame.createView();
        const trailPass = encoder.beginRenderPass(trailRenderDesc);
        trailPass.setPipeline(trailPipeline);
        trailPass.setVertexBuffer(0, canvasVertexBuffer);
        trailPass.setBindGroup(0, trailBindGroup);
        trailPass.draw(4);
        trailPass.end();

        encoder.copyTextureToTexture(
            {texture: trailFrame},
            {texture: prevFrame},
            [canvas.width, canvas.height]
        );

        // Final render.
        finalRenderDesc.colorAttachments[0].view = context.getCurrentTexture().createView();
        const finalPass = encoder.beginRenderPass(finalRenderDesc);
        finalPass.setPipeline(finalPipeline);
        finalPass.setVertexBuffer(0, canvasVertexBuffer);
        finalPass.setBindGroup(0, finalBindGroup);
        finalPass.draw(4);
        finalPass.end();

        device.queue.submit([encoder.finish()]);
    }



    // Stateful things.
    let cornerA = [0, 0];
    let cornerB = [0, 0];
    let frame = 0;

    function update() {
        cornerA[0] = 4 * Math.sin(frame/Math.PI/30);
        cornerA[1] = 4 * Math.cos(frame/Math.PI/30);
        cornerB[0] = 10 * Math.sin(-frame/Math.PI/20);
        cornerB[1] = 10 * Math.cos(-frame/Math.PI/20);
        device.queue.writeBuffer(lineVertexBuffer, 0, new Float32Array(cornerA.concat(cornerB)));
        ++frame;
    }

    function loop() {
        update();
        render();
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

}

main().catch(err => console.error(err));