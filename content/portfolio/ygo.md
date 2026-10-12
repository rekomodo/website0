---
title: "YGo: Peer-to-Peer Collaborative Editing"
description: "A YATA text CRDT, WebRTC editing, and a Raft-backed Go signaling service."
summary: "Collaborative text editing with a browser-side CRDT and a replicated backend for room assignment and signaling recovery."
projectPeriod: "May 2026"
projectDate: "2026-05-01"
projectTools: "Go · TypeScript · WebRTC · Raft"
tags: ["Distributed Systems", "Go", "CRDT", "WebRTC"]
cover:
    image: "images/ygo/backend.png"
    alt: "YGo node architecture connecting HTTP signaling, a gRPC key-value service, a replicated state machine, and Raft"
    hiddenInSingle: true
showToc: true
---

YGo is a collaborative editing app that uses near real-time peer-to-peer shared editing via CRDTs and a Go backend. We built it as a final project for MIT's 6.5840 Distributed Systems.

The primary goal of YGo was to achieve availability: it is disruptive for a user to be unable to create and edit documents because all resources are currently exhausted. We designed the signaling layer around near-stateless servers, allowing for quick horizontal scaling in case of need. By “near-stateless” we mean that some state is stored in each signaling server's memory, but losing the peer registry does not itself erase the clients' document state. Established peer connections can continue without signaling; connecting or reconnecting peers depends on recovering the room assignment.

A second goal was to achieve fault tolerance: if one of the signaling servers dies, clients should still be able to create documents and establish P2P connections, provided the backend retains a Raft quorum. Since the servers relay signaling traffic between clients, we designed the system so that every client within the same document connects to the same signaling server. Without carefully addressing the failure of a hosting server, there could be split brain in the client network, causing two or more groups of clients to be unable to communicate with each other.

## Contributions

I built YGo with Carolina Moura, with whom I coauthored the final report. I worked on the client described in Section III: the YATA list and text CRDT, its interface, and the peer-to-peer synchronization protocol. The Raft and key-value server code also came from my 6.5840 labs. For this project, we adapted the storage system to use gRPC instead of the simulated RPC system provided for testing.

## System Overview

A client can query any YGo node on its assigned HTTP port to create a document, referred to as a “room,” or look up its hosting signaling server. The client then opens a WebSocket to that host and receives the list of current collaborators. Via the WebSocket, clients exchange the information needed to establish WebRTC connections within the same document. Document edits travel over WebRTC data channels rather than through the Go server.

On startup, each backend node starts an HTTP server, a gRPC server, a key-value instance, and a Raft instance. Upon client requests, the HTTP server calls functions provided by the Clerk, which calls the KV service over the network. The replicated state machine under the KV server uses Raft as its consensus algorithm. Raft and KV share the gRPC listener and the client connections between nodes.

{{< figure src="/images/ygo/backend.png" alt="Report diagram of one YGo node: HTTP on port 8080 calls the Clerk; gRPC on port 7001 exposes KV and Raft, with the KV state machine submitting operations through the RSM" caption="Figure 1 from our final report: one backend node. HTTP and WebSocket traffic use port 8080; KV and Raft RPCs share port 7001. The browser-side CRDT is outside this backend diagram." >}}

The distinction between document state and room metadata is central to the design. The replicated backend stores room assignments and signaling-server heartbeats. The document itself lives in the peers' CRDT instances. Replicating metadata therefore does not make document content durable.

## The YATA List and Text CRDT

We employed the YATA approach to a Conflict-free Replicated Data Type, whose basic primitive is the YATA list. Peers can operate concurrently on different versions of the list and share updates without requiring consensus amongst themselves. Convergence depends on integrating the same updates using deterministic ordering rules.

A list item stores its identifier, creation-time origins, mutable linked-list neighbors, content, and a deletion flag:

\[
i = \langle ID,\mathrm{originLeft},\mathrm{originRight},\mathrm{left},\mathrm{right},\mathrm{content},\mathrm{deleted}\rangle.
\]

The origins refer to the IDs of the items immediately to the left and right of \(i\) when it was first created. The `left` and `right` fields are mutable pointers used to maintain the local view of the linked list. A boolean flag, or tombstone, is used for deletions to preserve the structure: an item is marked deleted rather than removed, so concurrent insertions referencing its ID as an origin can still be resolved.

Each item is assigned an ID consisting of a pair:

\[
ID = (f,c),
\]

where \(f\) identifies the client and \(c\) is a monotonically increasing insertion counter maintained by that client. The report described \(f\) as a UUID. In the supplied implementation, the browser hashes the signaling UUID with SHA-256 and uses the first signed 32-bit word as its numeric CRDT identifier. This is an identifier scheme rather than a guarantee of uniqueness; collisions remain possible.

### Deterministic Insertion

When integrating item \(i\), the local list may already contain other insertions between `originLeft` and `originRight`, made after \(i\) was created. To find its position deterministically, the algorithm traverses the local list from the left origin's right neighbor toward the right origin.

For items sharing the same left origin, it breaks ties by client identifier. An item with a smaller client identifier is resolved to the left of the incoming item. If it has the same right origin and does not sort to the left, the scan stops. The algorithm also tracks items encountered during the scan and unresolved conflicting items, so insertions whose origins lie within that region retain their relationship to preceding items. An item with a left origin outside the scanned region ends the scan. The new item is then linked immediately after the rightmost item resolved as being to its left.

The report defined a counter-first total order over IDs, but the insertion code uses client identifiers for the same-origin tie-break. The excerpt below shows that implemented rule and the dependency tracking directly.

{{< details title="Code: deterministic insertion scan" >}}

From `crdt/list.ts`; excerpt from the supplied source.

```typescript
    while (!ID.equals(scan.id, right.id)) {
      itemsBeforeOrigin.add(ID.key(scan.id));
      conflictingItems.add(ID.key(scan.id));

      if (ID.equals(scan.originLeft, item.originLeft)) {
        // tie-break by UUID
        if (scan.id.userID < item.id.userID) {
          left = scan;
          conflictingItems.clear();
        } else if (ID.equals(scan.originRight, item.originRight)) {
          break;
        }
      } else if (itemsBeforeOrigin.has(ID.key(scan.originLeft))) {
        if (!conflictingItems.has(ID.key(scan.originLeft))) {
          left = scan;
          conflictingItems.clear();
        }
      } else {
        break;
      }

      scan = this.getItem(scan.right);
    }
```

{{< /details >}}

When inserting multiple items at the same time, they may not be in dependency order. `applyUpdate` repeatedly integrates items whose origins are already known. If it drains the pending set, integration is complete; if a pass makes no progress and pending items remain, it throws an unresolved-origins error. For an item already present, it merges deletion state monotonically: an incoming tombstone can mark the existing item deleted, but cannot restore it.

We implemented a simple Text CRDT using the YATA list by making each insertion an individual character. Allowing arbitrary-length strings to be inserted as a single item, and splitting them only when required by later operations, remains a potential optimization.

### State Vectors and Deletions

A state vector records how many insertions from each client the peer knows. In the source, the stored value is the next counter after the greatest integrated counter:

\[
SV[f] = \max_{\text{integrated items from }f}(c+1),
\]

with zero used when none are known. `makeUpdate` sends items for which \(c \geq SV_{\mathrm{recipient}}[f]\). This representation assumes that the counter summarizes a complete prefix; it does not encode arbitrary gaps in a client's insertion history.

{{< details title="Code: selecting items missing from a state vector" >}}

From `crdt/list.ts`; excerpt from the supplied source.

```typescript
    const items: YataItem[] = [];
    for (const item of this.itemById.values()) {
      if (this.isSentinel(item)) continue;
      const known = target.get(item.id.userID) ?? 0;
      if (item.id.opCounter >= known) {
        items.push(item);
      }
    }

```

{{< /details >}}

Deletions do not allocate new insertion IDs. The protocol therefore sends tombstone keys separately from the insertion diff. `getItems` returns a left-to-right ordered list of items that have not been deleted, while the underlying tombstoned items remain available for resolving origins.

## Peer-to-Peer Synchronization

A group of peers sharing the same text instance communicates edits through `TextPeer`, a protocol layer that wraps the CRDT. The wire format has two message kinds: `stateVector`, carrying the sender's full state vector, and `update`, carrying CRDT items and tombstone keys.

### Initial Sync

When a peer's data channel to another peer first opens, it calls `syncWithPeer`, which sends a state-vector message. The receiver replies with an update containing every item the sender is missing, computed with `makeUpdate`, plus every tombstoned key. Because the data channel opens on both sides, the exchange runs symmetrically so each peer can acquire the other's state at the time of synchronization.

### Periodic Broadcast

After initial sync, a timer in the application layer calls `broadcastChanges`. Each call builds an item diff against `lastBroadcastSV` and a deletion list from tombstones appended since the previous broadcast. If either list is nonempty, it sends the update to every connected peer and advances both broadcast cursors.

{{< details title="Code: batched update broadcasts" >}}

From `web/src/lib/textPeer.ts`; excerpt from the supplied source.

```typescript
  broadcastChanges(rtc: RTC): void {
    const items = this.text.makeUpdate(this.lastBroadcastSV);
    const deletes = this.tombstoneOrder.slice(
      this.lastBroadcastTombstoneCount,
    );
    if (items.length === 0 && deletes.length === 0) return;
    const msg: WireMessage = { kind: "update", items, deletes };
    rtc.broadcast(JSON.stringify(msg));
    this.lastBroadcastSV = this.text.getStateVector();
    this.lastBroadcastTombstoneCount = this.tombstoneOrder.length;
    console.log("broadcastChanges", JSON.stringify(msg));
  }
```

{{< /details >}}

`handleMessage` applies incoming items and tombstones. In the supplied source, it leaves the broadcast cursors unchanged, allowing items and tombstones learned from one neighbor to ride out on the next broadcast to other neighbors. The cursor-advancing optimization in that method is commented out because it would suppress forwarding in a partially connected graph.

A useful property of this design is that the graph of peers need not be fully connected for updates to propagate. The design uses forwarding to propagate updates along paths in a connected component, provided dependencies can be integrated and messages continue to be delivered. Disconnected components cannot exchange edits until a path is restored. The browser's connection setup nevertheless attempts a mesh by connecting each new peer to the peers listed in its welcome message.

The supplied UI defaults to a two-second broadcast interval, adjustable from 200 ms to 10 seconds in 200 ms steps. These are batching settings, not measured end-to-end editing latencies. The local text changes immediately; remote visibility depends on the next broadcast, transport, and integration.

### Why broadcasting?

It's possible to implement the peer-to-peer protocol as a pull-based protocol instead of a push-based protocol. This would entail deciding when to request updates instead of when to send them to peers. I decided to stick with a push-based protocol for several reasons. First, it is much simpler to think about and implement. Broadcasting peers need not wait for a reply and receiving peers don't have to send one. Second, it removes needless probing that would occur with a pull-based approach. Peers can be optimized to only broadcast when they have something to share, reducing traffic. A notification-push and pull-based approach could circumvent these kinds of issues, but there is very little gain in complicating the approach in this way.

## Signaling and Room Assignment

The signaling server fulfills three purposes: it manages the creation of rooms, answers requests about which server currently hosts a room, and acts as a middleman in establishing P2P connections if it is the hosting server.

The storage interface provides versioned reads and conditional writes:

```text
GET(k) → (value, version)
PUT(k, v, version) → ok | ErrVersion | ErrMaybe
```

A successful write increments the version. `ErrVersion` indicates a conflicting version; `ErrMaybe` represents an uncertain outcome after a retry. This distinction matters because a failed response does not necessarily mean the original write was not applied.

The report described separate `server/<addr>` lease keys. The supplied source instead stores a serialized address-to-timestamp map under one `heartbeats` key. Each server updates its entry with a versioned read-modify-write. Room ownership is stored separately as `room/<id> → advertised address`.

### Heartbeats and Room Creation

Each server registers its advertised address and periodically renews its timestamp. With the supplied startup configuration, renewals are scheduled every 10 seconds and `Signalings` uses a 30-second freshness window. A server belongs to the live set when

\[
t_{\mathrm{local}} - t_{\mathrm{heartbeat}} \leq 30{,}000\ \mathrm{ms}.
\]

These values describe the implementation's timers; they are not a bound on failover time. Divergent wall clocks, failed renewals, retries, and delayed requests all affect detection.

On `POST /api/rooms`, the server lists the live signaling set, picks a host uniformly at random, generates a fresh six-character room ID, and attempts a version-zero write. The report called these IDs alphanumeric; the current generator uses uppercase letters only. The receiving server need not be the chosen host: any signaling server can create a room on behalf of another. The current creation loop generates a new ID after any non-OK result, rather than distinguishing only version conflicts.

### Lookup and Reassignment

On `GET /api/rooms/:room`, the server reads the room assignment and checks whether the recorded host is still in the live set. If it is, its address is returned. If its heartbeat has expired, the server picks a new host and writes it with the version observed during lookup. If another lookup raced this update, `ErrVersion` causes the check to repeat.

{{< details title="Code: conditional reassignment after a host expires" >}}

From `server.go`; excerpt from the supplied source.

```go
		// The server is dead, pick a new random server
		newServer := live[rand.Intn(len(live))]
		putErr := s.ck.Put("room/"+room, newServer, version)

		if putErr == rpc.OK {
			fmt.Printf("Room %q reassigned: %q (dead) -> %q\n", room, server, newServer)
			return newServer, rpc.OK
		}
		if putErr == rpc.ErrVersion { // someone raced us; prob will get out in the next iteration
			continue
		}
		return "", putErr
```

{{< /details >}}

The host can die between the lookup and the client's connection attempt. The client discovers this when connecting fails and repeats the lookup. In the supplied frontend, reconnection starts with a 500 ms backoff, doubles on repeated failures, and caps at 10 seconds. Lookup tries the page's origin and a hard-coded list of three localhost servers, which would need to be replaced for deployment.

### Establishing Peer Connections

Before upgrading a WebSocket, the server validates the room and checks that it is still the assigned host. On a successful upgrade, it assigns a fresh peer UUID, inserts the connection into its in-memory room registry, and sends a welcome message carrying that ID and the IDs of current peers.

Peers use signaling to exchange SDP offers, answers, and ICE candidates. The report described all peer JSON as broadcast; the source stamps the sender's ID and unicasts messages with a `to` field to that peer. Messages without a target are broadcast to the other peers in the room. Once WebRTC data channels are established, edits use those channels.

### Recovering from Signaling Failure

We addressed two kinds of failure. When the hosting signaling server dies, its heartbeat eventually expires. A subsequent lookup through a surviving node reassigns the room. Clients notice the WebSocket close and repeat the lookup, reconnecting to the new host. The frontend keeps its RTC instance and CRDT across the signaling outage, so the outage alone does not tear down established data channels or discard document state. Recovery behavior also depends on subsequent peer-membership messages and reconnection.

A server can also be reassigned away from a room while still alive if it misses enough heartbeats. It may still hold open WebSockets for rooms it no longer owns. To address this stale registry, each server runs an eviction check every 10 seconds. If it discovers it is no longer the assigned host, it closes the room's WebSockets, triggering client lookup and reconnection. This is a periodic recovery mechanism, not an instantaneous fencing guarantee.

## Replicated Key-Value Storage

For the storage system, we used the code from Lab 4 and adapted it to gRPC. We also used the lab's Raft code beneath the replicated state machine that sustains the KV server. Both `Get` and `Put` handlers submit operations through the RSM; the Clerk retries against other nodes when it receives `ErrWrongLeader` or cannot reach a server.

The KV state machine accepts a write only when its expected version matches the current value. For a new key, the expected version must be zero.

{{< details title="Code: version checks in the KV state machine" >}}

From `kv/kv.go`; excerpt from the supplied source.

```go
	vv, ok := kv.store[args.Key]
	if !ok && args.Version != 0 {
		reply.Err = rpc.ErrNoKey
		return
	}
	if ok && vv.Version != args.Version {
		reply.Err = rpc.ErrVersion
		return
	}
	kv.store[args.Key] = VersionedValue{Value: args.Value, Version: args.Version + 1}
	reply.Err = rpc.OK
```

{{< /details >}}

The source uses a bbolt-backed persister for Raft state and snapshot bytes. This storage supports the replicated metadata layer; it does not store the browser's text CRDT. KV snapshot and restore methods exist, while `bootRaft` passes `-1` as the RSM's snapshot threshold, disabling automatic size-triggered snapshots in this configuration.

The report assumed an always-available, strongly consistent storage service when explaining signaling. In practice, committing these operations requires a Raft majority. The supplied Compose configuration contains three nodes, so two are required for a quorum. Adding signaling capacity does not itself provide automatic Raft membership changes. Existing peer editing can continue independently of the backend, but room creation, lookup, and reassignment depend on the metadata service making progress.

## Results and Limitations

We implemented the browser-side YATA list and character-based text wrapper, initial state exchange, periodic edit broadcasts, WebRTC signaling, versioned room assignment, heartbeat-based discovery, and periodic eviction of stale room registries. The final report described the architecture and recovery paths but did not include quantitative latency, throughput, scalability, or failover measurements. The timer values above are source configuration, and the recovery paths describe mechanisms rather than experimentally established guarantees.

The project has several limitations:

- **Document durability.** Content is not saved to persistent storage. Once the last peer leaves a room, the document content is lost even if its room assignment remains in the database.
- **Resource exhaustion.** There is no authentication or rate limiting to prevent a user from creating large numbers of rooms. Room records accumulate in the metadata store; retained items and tombstones also grow with edit history.
- **Wall-clock leases.** Heartbeat freshness relies on each machine's clock. Clock differences can cause a node to be declared dead prematurely, and storing all heartbeats in one map introduces contention on that key.
- **Editor scope.** The supplied UI handles single-character insertion, line breaks, and single-character deletion. It rejects range edits, paste, IME composition, and other multi-character inputs.
- **Update handling.** Unknown tombstone keys are ignored, and unresolved insertion origins cause an exception rather than entering a persistent retry queue. These paths limit the implementation's tolerance of missing dependencies; connected topology alone is not an unconditional delivery or convergence guarantee.

Planned work included a `Sync` operation to store CRDT state in the database, client snapshots for document persistence, authentication, rate limiting, a load balancer, and a more reliable lease implementation. Arbitrary-length text items remain another potential optimization. These features are not implemented in the supplied source.

## Source Code and References

[Project source](https://github.com/CarolinaMoura/6.5840-final-project).

The underlying Raft and KV code originated in my course labs. The report asks readers to obtain permission before accessing that lab repository.

The CRDT design followed P. Nicolaescu, K. Jahns, M. Derntl, and R. Klamma, *Near real-time peer-to-peer shared editing on extensible data types*, GROUP '16, pp. 39–49 ([DOI](https://doi.org/10.1145/2957276.2957310)).
