# 并发与 Worker Thread

项目里的耗时任务分为两类，不能用同一种方式处理。

## 网络 I/O 使用异步并发

文章生成、远程 Embedding、网页抓取和图片生成的主要时间都花在等待网络响应。JavaScript 在等待期间不会占用 CPU，因此不需要 Worker Thread。批量任务使用 `Promise.all` 或有限并发池即可。

`mapWithConcurrency(items, 3, task)` 最多同时执行三个任务，并把结果放回原来的索引位置。单个任务失败时，调用方可以把错误转换为普通结果，从而避免整批失败。批量封面使用这种方式，既比串行快，又不会一次向图片服务发出十个请求。

## CPU 密集任务使用 Worker Thread

本地 Embedding 会运行 ONNX 模型，HNSW 构建还要计算和组织大量向量。这些操作即使返回 Promise，也可能长时间占用 Node 主线程。`setImmediate` 只能推迟开始时间，不能把计算移出主线程。

知识库重建现在由一个常驻 Worker Thread 执行：

```text
HTTP 主线程
  接收请求、鉴权、维护进度
          | postMessage
          v
RAG Worker Thread
  扫描文章、切片、本地或远程 Embedding、构建 HNSW
          | result/error
          v
HTTP 主线程
  更新构建状态，继续响应查询
```

只保留一个 worker，是为了复用已经加载的本地模型，并避免多个索引任务同时占用大量内存。worker 内还有 Promise 队列，即使以后主线程同时提交多个任务，也会逐个执行。

## 索引为什么要原子替换

新索引先写到 `rag_index_users/<user>.staging-<uuid>`。全部文件写完后，旧索引先改名为备份目录，新索引再改名到正式目录。成功后删除备份；替换失败则恢复旧目录。这样 worker 崩溃或构建失败时，线上检索仍能使用上一版完整索引。

## 生命周期

- 没有任务时对 worker 调用 `unref()`，它不会阻止服务正常退出。
- 提交任务前调用 `ref()`，保证构建完成前 Node 不会提前退出。
- worker 异常退出时，管理器会拒绝所有等待中的 Promise；下次请求会创建新 worker。
- 测试可以调用 `closeRagIndexWorker()` 主动释放线程。

## 什么时候不要使用 Worker Thread

- 等待 HTTP、数据库或文件读取：优先异步 API 和有限并发。
- Sharp 图片处理：Sharp 本身使用 libuv/native 线程池，通常不必再套 worker。
- 很短的字符串处理：传消息和序列化成本可能比计算本身更高。
- 依赖共享内存状态的业务逻辑：worker 有独立模块实例，不能直接共享 Map、数据库连接或模型实例。

## 后续扩展

数据规模继续增长后，可以增加以下能力：

- 给已加载的 HNSW 索引加按用户缓存，避免每次搜索都从磁盘加载。
- 用 worker 消息上报切片、Embedding、写索引三个阶段的细粒度进度。
- 为 worker 增加任务超时和取消消息，而不是只能等待当前构建结束。
- 将全量重建改为增量索引，只处理新增或发生变化的文章。
- 当单机内存成为瓶颈时，把索引构建迁移到独立进程或任务服务。进程隔离比线程更耗资源，但崩溃边界更清楚。
