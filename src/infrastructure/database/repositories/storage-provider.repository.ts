import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, LessThanOrEqual } from "typeorm";
import { StorageProviderEntity } from "../entities/storage-provider.entity";
import { StorageProvider } from "../../../domain/entities/storage-provider.entity";
import { IStorageProviderRepository, ProviderMetrics } from "../../../domain/interfaces/repositories.interface";
import { type Hex } from "../../../common/types";

@Injectable()
export class StorageProviderRepository implements IStorageProviderRepository {
  constructor(
    @InjectRepository(StorageProviderEntity)
    private readonly repository: Repository<StorageProviderEntity>,
  ) {}

  async create(provider: StorageProvider): Promise<StorageProvider> {
    const entity = this.toEntity(provider);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async update(id: string, provider: Partial<StorageProvider>): Promise<StorageProvider> {
    await this.repository.update(id, provider as any);
    const updated = await this.repository.findOne({ where: { id } });
    if (!updated) {
      throw new Error(`StorageProvider with id ${id} not found`);
    }
    return this.toDomain(updated);
  }

  async findById(id: string): Promise<StorageProvider | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByAddress(address: string): Promise<StorageProvider | null> {
    const entity = await this.repository.findOne({ where: { address } });
    return entity ? this.toDomain(entity) : null;
  }

  async findActive(): Promise<StorageProvider[]> {
    const entities = await this.repository.find({
      where: { isActive: true },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async findProvidersForDeals(intervalMinutes: number): Promise<StorageProvider[]> {
    const cutoffTime = new Date(Date.now() - intervalMinutes * 60 * 1000);

    const entities = await this.repository.find({
      where: [{ isActive: true }, { isActive: true, lastDealTime: LessThanOrEqual(cutoffTime) }],
    });

    return entities.map((e) => this.toDomain(e));
  }

  async updateMetrics(providerId: string, metrics: ProviderMetrics): Promise<void> {
    const provider = await this.repository.findOne({ where: { id: providerId } });
    if (!provider) return;

    provider.totalDeals = metrics.totalDeals;
    provider.successfulDeals = metrics.successfulDeals;
    provider.failedDeals = metrics.failedDeals;
    provider.averageIngestLatency = metrics.averageIngestLatency;
    provider.averageRetrievalLatency = metrics.averageRetrievalLatency;
    provider.successRate = (metrics.successfulDeals / metrics.totalDeals) * 100;

    await this.repository.save(provider);
  }

  private toEntity(provider: StorageProvider): Partial<StorageProviderEntity> {
    return { ...provider };
  }

  private toDomain(entity: StorageProviderEntity): StorageProvider {
    return new StorageProvider({ ...entity, address: entity.address as Hex });
  }
}
