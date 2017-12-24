"use strict";
/**
 * 使用 Web Worker 实现的线程池
 */
class ThreadPool {
    /**
     * 创建一个线程池
     * @param fn 线程池要执行的函数，它不可带有任何闭包变量，且只能使用有限的函数。
     * 详见 https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope
     * @param size 线程个数（最大并发数，必须为大于 0 的整数）
     */
    constructor(fn, size = navigator.hardwareConcurrency - 1) {
        this.queue = [];
        if (size < 1)
            throw new RangeError('size must greater than 0');
        const workerContext = 'data:text/javascript,' + encodeURIComponent(`'use strict';
const __fn = (${fn});
onmessage = e => postMessage(__fn(...e.data));`);
        this.freeWorkers = Array.from({ length: size }, () => new Worker(workerContext));
        this.workers = new Set(this.freeWorkers);
    }
    /**
     * 当有线程空余时，将参数转发至线程，开始执行。
     * 当没有线程空余时，将参数追加至调度队列，等待其他线程空余。
     * @param args 传入线程函数的参数。注意它们会以结构化克隆的方式传入（类似深拷贝），而非通常的引用传值。
     * https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
     * @returns Promise，当线程函数执行完毕后 resolve 其返回值
     */
    dispatch(...args) {
        return new Promise((resolve, reject) => this.start(resolve, reject, args));
    }
    /**
     * 立即结束所有线程，释放资源。
     * 注意：本函数会强制停止正在运行中的线程，并 reject 所有等待中的 promise
     */
    dispose() {
        this.freeWorkers.forEach(x => {
            this.workers.delete(x);
            x.terminate();
        });
        this.queue.forEach(([, reject]) => reject(new TypeError('threadpool disposed')));
        this.queue.length = 0;
        this.workers.forEach(x => {
            x.terminate();
            x.onerror(new ErrorEvent('error', { error: new TypeError('threadpool disposed') }));
        });
        this.workers.clear();
        this.freeWorkers.length = 0;
    }
    /**
     * 获得当前空闲的线程个数
     */
    getFreeWorkerCount() {
        return this.freeWorkers.length;
    }
    /**
     * 获得当前运行中的线程个数
     */
    getRunningWorkerCount() {
        return this.workers.size - this.freeWorkers.length;
    }
    /**
     * 获得当前在队列中等待的事件个数
     */
    getWaitingEventCount() {
        return this.queue.length;
    }
    /// 私有方法
    onFinish(worker) {
        worker.onmessage = null;
        worker.onerror = null;
        this.freeWorkers.push(worker);
        if (this.queue.length) {
            this.start(...this.queue.shift());
        }
    }
    start(resolve, reject, args) {
        if (this.freeWorkers.length) {
            const worker = this.freeWorkers.pop();
            worker.onmessage = e => {
                this.onFinish(worker);
                resolve(e.data);
            };
            worker.onerror = e => {
                this.onFinish(worker);
                reject(e.error);
            };
            worker.postMessage(args);
        }
        else {
            this.queue.push([resolve, reject, args]);
        }
    }
}
