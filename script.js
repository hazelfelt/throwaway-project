async function main() {

    // Adapter, device.
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) throw new Error('need a browser that supports WebGPU');



    // Canvas and WebGPU context.
    const canvas = document.querySelector('canvas');
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: canvasFormat,
    });



    // Shader.
    const wgsl = `
    struct Triangle {
        color: array<vec3f, 3>,
        scale: vec2f,
        offset: vec2f,
    };

    struct Vertex {
        @location(0) color: vec3f,
        @builtin(position) position: vec4f,
    }

    @group(0) @binding(0) var<uniform> frame: u32;
    @group(0) @binding(1) var<uniform> triangle: Triangle;

    const corner = array<vec2f, 3>(
        vec2f( 0.0,  0.5),  // top center
        vec2f(-0.5, -0.5),  // bottom left
        vec2f( 0.5, -0.5)   // bottom right
    );

    @vertex fn main_vertex(
        @builtin(vertex_index) v: u32,
        @builtin(instance_index) i: u32,
    ) -> Vertex {

        let position = corner[v] * triangle.scale + triangle.offset;

        let position_shaken = vec2(
            position.x + fract(sin(f32(frame))*100000.0) * 0.015,
            position.y + fract(sin(f32(frame + 100))*100000.0) * 0.015
        );

        return Vertex(triangle.color[v], vec4(position_shaken, 0.0, 1.0));
    }

    @fragment fn main_fragment(
        @location(0) color: vec3f,
    ) -> @location(0) vec4f {
        return vec4f(color, 1.0);
    }`;

    const module = device.createShaderModule({
        label: "it's a shader!",
        code: wgsl,
    });



    // Pipeline.
    const pipeline = device.createRenderPipeline({
        label: "it's a pipeline!",
        layout: 'auto',
        vertex: {
            module,
            entryPoint: 'main_vertex',
        },
        fragment: {
            module,
            entryPoint: 'main_fragment',
            targets: [{ format: canvasFormat }],
        },
    });



    // Triangle data.
    const triangle = {
        color: [
            [ -0.3,  0.3,  0.3 ],
            [ -0.3,  0.6,  0.3 ],
            [ -0.3, -0.1,  0.3 ],
        ],
        scale: [1.0, 1.0],
        offset: [-0.3, -0.3],
    };



    // Triangle buffer.
    const triangleBuffer = device.createBuffer({
        label: "triangle buffer",
        size: 4 * 16, // 16 floats in a triangle (includes padding).
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    {
        const array = new Float32Array(16);
        array.set(triangle.color[0], 0);
        array.set(triangle.color[1], 4);
        array.set(triangle.color[2], 8);
        array.set(triangle.scale,   12);
        array.set(triangle.offset,  14);
        device.queue.writeBuffer(triangleBuffer, 0, array);
    }

    // Frame number buffer.
    const frameBuffer = device.createBuffer({
        label: "frame buffer",
        size: 4, // one single u32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(frameBuffer, 0, new Uint32Array([1]));

    // Bind group.
    const bindGroup = device.createBindGroup({
        label: "bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: frameBuffer } },
            { binding: 1, resource: { buffer: triangleBuffer } },
        ],
    })



    // Render.
    function render() {

        // Command encoder, render pass.
        const encoder = device.createCommandEncoder({ label: 'encoder' });
        const pass = encoder.beginRenderPass({
            label: 'render pass',
            colorAttachments: [
                { // We're rendering to the canvas's current texture.
                    view: context.getCurrentTexture().createView(),
                    clearValue: [1.0, 1.0, 1.0, 1.0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        });

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);  // draw 3 vertices
        pass.end();

        // We're done. Form a command buffer from `encoder`, and submit it.
        device.queue.submit([encoder.finish()]);

    }
    render();



    // Whenever the canvas is clicked.
    const counterElement = document.querySelector("p");
    let counter = 0;
    canvas.onmousedown = function () {
        console.log("this should do something...");
    }

    function loop() {
        counterElement.innerText = ++counter;
        device.queue.writeBuffer(frameBuffer, 0, new Uint32Array([counter])); // NOTE: probably REALLY inefficient!
        render();
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

// Prevent Edge's context menu.
window.onmouseup = event => event.preventDefault();

main().catch(err => console.error(err));