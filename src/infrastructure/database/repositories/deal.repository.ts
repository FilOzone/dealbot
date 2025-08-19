import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between } from "typeorm";
import { DealEntity } from "../entities/deal.entity";
import { Deal } from "../../../domain/entities/deal.entity";
import { IDealRepository, DealMetrics } from "../../../domain/interfaces/repositories.interface";
import { DealStatus, DealType } from "../../../domain/enums/deal-status.enum";
import { type Hex } from "../../../common/types";

@Injectable()
export class DealRepository implements IDealRepository {
  constructor(
    @InjectRepository(DealEntity)
    private readonly repository: Repository<DealEntity>,
  ) {}

  async create(deal: Deal): Promise<Deal> {
    const entity = this.toEntity(deal);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async update(id: string, deal: Partial<Deal>): Promise<Deal> {
    await this.repository.update(id, deal);
    const updated = await this.repository.findOne({ where: { id } });
    if (!updated) {
      throw new Error(`Deal with id ${id} not found`);
    }
    return this.toDomain(updated);
  }

  async findById(id: string): Promise<Deal | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByDealId(dealId: string): Promise<Deal | null> {
    const entity = await this.repository.findOne({ where: { dealId } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByCid(cid: string): Promise<Deal | null> {
    const entity = await this.repository.findOne({ where: { cid } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByStatus(status: DealStatus): Promise<Deal[]> {
    const entities = await this.repository.find({ where: { status } });
    return entities.map((e) => this.toDomain(e));
  }

  async findByStorageProvider(providerId: string): Promise<Deal[]> {
    const entities = await this.repository.find({
      where: { storageProvider: providerId },
      order: { createdAt: "DESC" },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async findPendingDeals(): Promise<Deal[]> {
    const entities = await this.repository.find({
      where: [{ status: DealStatus.PENDING }, { status: DealStatus.UPLOADED }],
      order: { createdAt: "ASC" },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async findRecentCompletedDeals(limit: number): Promise<Deal[]> {
    const entities = await this.repository.find({
      where: [{ status: DealStatus.DEAL_CREATED }, { status: DealStatus.PIECE_ADDED }],
      order: { createdAt: "DESC" },
      take: limit,
    });
    return entities.map((e) => this.toDomain(e));
  }

  async getMetrics(startDate: Date, endDate: Date): Promise<DealMetrics> {
    const deals = await this.repository.find({
      where: {
        createdAt: Between(startDate, endDate),
      },
    });

    const totalDeals = deals.length;
    const successfulDeals = deals.filter(
      (d) => d.status === DealStatus.DEAL_CREATED || d.status === DealStatus.PIECE_ADDED,
    ).length;
    const failedDeals = deals.filter((d) => d.status === DealStatus.FAILED).length;

    const avgIngestLatency =
      deals.filter((d) => d.ingestLatency !== null).reduce((sum, d) => sum + d.ingestLatency, 0) /
      (deals.filter((d) => d.ingestLatency !== null).length || 1);

    const avgChainLatency =
      deals.filter((d) => d.chainLatency !== null).reduce((sum, d) => sum + d.chainLatency, 0) /
      (deals.filter((d) => d.chainLatency !== null).length || 1);

    const dealsByProvider = new Map<string, number>();
    const dealsByType = new Map<DealType, number>();

    deals.forEach((deal) => {
      dealsByProvider.set(deal.storageProvider, (dealsByProvider.get(deal.storageProvider) || 0) + 1);
      dealsByType.set(
        deal.withCDN ? DealType.WITH_CDN : DealType.WITHOUT_CDN,
        (dealsByType.get(deal.withCDN ? DealType.WITH_CDN : DealType.WITHOUT_CDN) || 0) + 1,
      );
    });

    return {
      totalDeals,
      successfulDeals,
      failedDeals,
      averageIngestLatency: avgIngestLatency,
      averageChainLatency: avgChainLatency,
      dealsByProvider,
      dealsByType,
    };
  }

  private toEntity(deal: Deal): any {
    const entity: any = { ...deal };
    if (deal.fileSize !== undefined) {
      entity.fileSize = deal.fileSize.toString();
    }
    if (deal.pieceSize !== undefined) {
      entity.pieceSize = deal.pieceSize.toString();
    }
    return entity;
  }

  private toDomain(entity: DealEntity): Deal {
    return new Deal({
      ...entity,
      storageProvider: entity.storageProvider as Hex,
      walletAddress: entity.walletAddress as Hex,
      transactionHash: entity.transactionHash as Hex,
      fileSize: entity.fileSize ? Number(entity.fileSize) : 0,
      pieceSize: entity.pieceSize ? Number(entity.pieceSize) : 0,
    });
  }
}
