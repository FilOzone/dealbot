import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between } from "typeorm";
import { RetrievalEntity } from "../entities/retrieval.entity.js";
import { Retrieval } from "../../../domain/entities/retrieval.entity.js";
import { IRetrievalRepository, RetrievalMetrics } from "../../../domain/interfaces/repositories.interface.js";
import { RetrievalStatus } from "../../../domain/enums/deal-status.enum.js";
import { type Hex } from "../../../common/types.js";

@Injectable()
export class RetrievalRepository implements IRetrievalRepository {
  constructor(
    @InjectRepository(RetrievalEntity)
    private readonly repository: Repository<RetrievalEntity>,
  ) {}

  async create(retrieval: Retrieval): Promise<Retrieval> {
    const entity = this.toEntity(retrieval);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async update(id: string, retrieval: Partial<Retrieval>): Promise<Retrieval> {
    await this.repository.update(id, retrieval as any);
    const updated = await this.repository.findOne({ where: { id } });
    if (!updated) {
      throw new Error(`Retrieval with id ${id} not found`);
    }
    return this.toDomain(updated);
  }

  async findById(id: string): Promise<Retrieval | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByCid(cid: string): Promise<Retrieval[]> {
    const entities = await this.repository.find({
      where: { cid },
      order: { createdAt: "DESC" },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async findPendingRetrievals(): Promise<Retrieval[]> {
    const entities = await this.repository.find({
      where: [{ status: RetrievalStatus.PENDING }, { status: RetrievalStatus.IN_PROGRESS }],
      order: { createdAt: "ASC" },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async getMetrics(startDate: Date, endDate: Date): Promise<RetrievalMetrics> {
    const retrievals = await this.repository.find({
      where: {
        createdAt: Between(startDate, endDate),
      },
    });

    const totalRetrievals = retrievals.length;
    const successfulRetrievals = retrievals.filter((r) => r.status === RetrievalStatus.SUCCESS).length;
    const failedRetrievals = retrievals.filter((r) => r.status === RetrievalStatus.FAILED).length;

    const avgLatency =
      retrievals.filter((r) => r.latency !== null).reduce((sum, r) => sum + r.latency, 0) /
      (retrievals.filter((r) => r.latency !== null).length || 1);

    const avgThroughput =
      retrievals.filter((r) => r.throughput !== null).reduce((sum, r) => sum + r.throughput, 0) /
      (retrievals.filter((r) => r.throughput !== null).length || 1);

    // Calculate CDN vs Direct comparison
    const cdnRetrievals = retrievals.filter((r) => r.withCDN);
    const directRetrievals = retrievals.filter((r) => !r.withCDN);

    const cdnMetrics = this.calculateTypeMetrics(cdnRetrievals);
    const directMetrics = this.calculateTypeMetrics(directRetrievals);

    return {
      totalRetrievals,
      successfulRetrievals,
      failedRetrievals,
      averageLatency: avgLatency,
      averageThroughput: avgThroughput,
      cdnVsDirectComparison: {
        cdn: cdnMetrics,
        direct: directMetrics,
      },
    };
  }

  private calculateTypeMetrics(retrievals: RetrievalEntity[]) {
    if (retrievals.length === 0) {
      return { avgLatency: 0, successRate: 0 };
    }

    const successCount = retrievals.filter((r) => r.status === RetrievalStatus.SUCCESS).length;
    const avgLatency =
      retrievals.filter((r) => r.latency !== null).reduce((sum, r) => sum + r.latency, 0) /
      (retrievals.filter((r) => r.latency !== null).length || 1);

    return {
      avgLatency,
      successRate: (successCount / retrievals.length) * 100,
    };
  }

  private toEntity(retrieval: Retrieval): any {
    const entity: any = { ...retrieval };
    if (retrieval.bytesRetrieved !== undefined && retrieval.bytesRetrieved !== null) {
      entity.bytesRetrieved = retrieval.bytesRetrieved.toString();
    }
    return entity;
  }

  private toDomain(entity: RetrievalEntity): Retrieval {
    return new Retrieval({
      ...entity,
      storageProvider: entity.storageProvider as Hex,
      bytesRetrieved: entity.bytesRetrieved ? Number(entity.bytesRetrieved) : 0,
    });
  }
}
