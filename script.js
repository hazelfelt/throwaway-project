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
    @group(0) @binding(1) var<uniform> initial: Triangle;
    @group(0) @binding(2) var<uniform> delta: Triangle;
    @group(0) @binding(3) var<uniform> wobble_intensity: f32;

    const corner = array<vec2f, 3>(
        vec2f( 0.0,  0.5),  // top center
        vec2f(-0.5, -0.5),  // bottom left
        vec2f( 0.5, -0.5)   // bottom right
    );

    @vertex fn main_vertex(
        @builtin(vertex_index) v: u32,
        @builtin(instance_index) i: u32,
    ) -> Vertex {

        let triangle = instance_triangle(i);

        let canvas_position = corner[v] * triangle.scale + triangle.offset;
        let wobble_position = canvas_position + vec2(
             sin(f32(frame+i*4) / 3.0) * wobble_intensity,
            -cos(f32(frame+i*4) / 3.0) * wobble_intensity,
        );

        return Vertex(triangle.color[v], vec4(wobble_position, 0.0, 1.0));
    }

    // Returns the triangle specific to this instance.
    fn instance_triangle(i: u32) -> Triangle {

        // NOTE: this part here is a little redundant, because each time
        // it's called, it calculates 3 vertices worth of color...
        // yet it's called once every vertex!
        //
        // i wonder what a better way to do this would be...
        let color = array<vec3f, 3>(
            initial.color[0] + f32(i)*delta.color[0],
            initial.color[1] + f32(i)*delta.color[1],
            initial.color[2] + f32(i)*delta.color[2],
        );

        let scale  = initial.scale  + f32(i)*delta.scale;
        let offset = initial.offset + f32(i)*delta.offset;

        return Triangle(color, scale, offset);
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
    const triangleCount = 10;

    const initialTriangle = {
        color: [
            [ -0.3,  0.3,  0.3 ],
            [ -0.3,  0.6,  0.3 ],
            [ -0.3, -0.1,  0.3 ],
        ],
        scale: [1.0, 1.0],
        offset: [-0.3, -0.3],
    };

    const deltaTriangle = {
        color: [
            [ 0.1, 0.1, 0.1 ],
            [ 0.1, 0.1, 0.1 ],
            [ 0.1, 0.1, 0.1 ],
        ],
        scale: [-0.09, -0.09],
        offset: [0.1, 0.1],
    };



    // Given triangle data, this function writes to a GPU buffer and returns it.
    function triangleBuffer(triangle, label) {
        const buffer = device.createBuffer({
            label,
            size: 4 * 16, // 16 floats per triangle (includes padding).
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const array = new Float32Array(16);
        array.set(triangle.color[0], 0);
        array.set(triangle.color[1], 4);
        array.set(triangle.color[2], 8);
        array.set(triangle.scale,   12);
        array.set(triangle.offset,  14);
        device.queue.writeBuffer(buffer, 0, array);

        return buffer;
    }

    // Triangle buffers
    const initialBuffer = triangleBuffer(initialTriangle, "initial triangle buffer");
    const deltaBuffer = triangleBuffer(deltaTriangle, "delta triangle buffer");

    // Frame number buffer.
    const frameBuffer = device.createBuffer({
        label: "frame buffer",
        size: 4, // one single u32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(frameBuffer, 0, new Uint32Array([0]));

    // Wobble intensity buffer.
    const wobbleIntensityBuffer = device.createBuffer({
        label: "wobble intensity buffer",
        size: 4, // one single f32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(wobbleIntensityBuffer, 0, new Float32Array([0.0]));



    // Bind group.
    const bindGroup = device.createBindGroup({
        label: "bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: frameBuffer } },
            { binding: 1, resource: { buffer: initialBuffer } },
            { binding: 2, resource: { buffer: deltaBuffer } },
            { binding: 3, resource: { buffer: wobbleIntensityBuffer } },
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
        pass.draw(3, triangleCount);  // draw 3 vertices for each triangle
        pass.end();

        // We're done. Form a command buffer from `encoder`, and submit it.
        device.queue.submit([encoder.finish()]);

    }
    render();



    // (descriptive comment pending)
    const counterElement = document.querySelector("p");
    let counter = 0;
    let wobbleIntensity = 0.0;
    canvas.onmousedown = () => wobbleIntensity = wobbleIntensity * 2 + 0.15;

    function loop() {

        // NOTE: i'm guessing it's really inefficient to make a new array every frame
        // i'll fix this whenever i refactor things later
        device.queue.writeBuffer(frameBuffer, 0, new Uint32Array([counter]));
        device.queue.writeBuffer(wobbleIntensityBuffer, 0, new Float32Array([wobbleIntensity]));
        render();
        requestAnimationFrame(loop);

        counterElement.innerText = ++counter;
        wobbleIntensity /= 1.05;
    }
    requestAnimationFrame(loop);
}

// Prevent Edge's context menu.
window.onmouseup = event => event.preventDefault();

main().catch(err => console.error(err));