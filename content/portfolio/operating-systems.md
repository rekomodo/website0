---
title: "Operating Systems: Memory, Networking, and Files"
description: "Copy-on-write memory, an Ethernet driver, concurrent allocation, and file-backed mappings in xv6."
summary: "A collection of OS assignments exploring what happens behind familiar operations like fork, opening a file, and receiving a packet."
projectPeriod: "Fall 2025"
projectTools: "C · RISC-V · xv6 · QEMU"
tags: ["Operating Systems", "C", "RISC-V"]
cover:
    image: "images/operating-systems/page-table.png"
    alt: "Page table translating a virtual address into a physical address"
    hiddenInSingle: true
draft: false
showToc: true
---

For MIT's 6.1810 Operating System Engineering course, I implemented a series of assignments in xv6, a small Unix-like operating system for RISC-V. The work covered virtual memory, networking, synchronization, and file systems. Working inside a kernel gave me a better understanding of what happens behind operations I normally just call from a program.

Here's a small overview of my favorite parts of OS.

## Copy-On-Write

I implemented copy-on-write for `fork`. Instead of immediately copying a process's memory, the parent and child initially share physical pages. Pages that were writable become read-only, and a write triggers a page fault that creates a private copy.

I added a page-table flag to distinguish these pages, reference counts to track their lifetime, and handling for writes made through the kernel's `copyout` function.

## NIC Driver

I implemented transmit and receive handling for the emulated E1000 Ethernet device, along with UDP port binding and packet queues. A process waiting for a packet sleeps until the receive path wakes it up.

The driver uses rings of descriptors shared with the OS via MMIO. I replace received buffers before handing packets to the network stack, and reclaim transmitted buffers once the device is done with them.

{{< details title="Code: waiting for a packet" >}}

```c
char *packet;
while((packet = (char *) udp_port->packet_ring[udp_port->head]) == 0) {
  sleep(udp_port, &netlock);
}
```

`sleep` releases the lock while the process waits, then reacquires it before returning. The loop checks the queue again after waking up.

{{< /details >}}

## Letting CPUs Work in Parallel

I split the physical memory allocator into per-CPU free lists, each with its own lock. When one list is empty, it can take a page from another CPU's list. I also implemented a reader-writer spinlock that allows multiple readers, with pending writers preventing new readers from entering.

## Extending the File System

I added doubly indirect blocks so files could grow beyond xv6's original limit, including the cleanup needed when truncating them. I also implemented symbolic links, following chains when opening a file and supporting `O_NOFOLLOW`.

## Mapping Files into Memory

I added file-backed `mmap` and `munmap`. Each process records its mapped regions, and page faults load file contents as those pages are accessed. Shared mappings write data back during unmapping, while private mappings keep changes out of the file. I also added handling for these regions across `fork`, exit, and `exec`.

Accessing a file through a pointer still involves allocating pages, checking permissions, and managing the underlying file's lifetime.
