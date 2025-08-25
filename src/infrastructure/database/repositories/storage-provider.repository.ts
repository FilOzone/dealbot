import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, LessThanOrEqual } from "typeorm";
import { StorageProviderEntity } from "../entities/storage-provider.entity.js";
import { StorageProvider } from "../../../domain/entities/storage-provider.entity.js";
import { IStorageProviderRepository } from "../../../domain/interfaces/repositories.interface.js";
import { type Hex } from "../../../common/types.js";

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

  async update(address: string, provider: Partial<StorageProvider>): Promise<StorageProvider> {
    await this.repository.update(address, provider as any);
    const updated = await this.repository.findOne({ where: { address } });
    if (!updated) {
      throw new Error(`StorageProvider with address ${address} not found`);
    }
    return this.toDomain(updated);
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

  private toEntity(provider: StorageProvider): Partial<StorageProviderEntity> {
    return { ...provider };
  }

  private toDomain(entity: StorageProviderEntity): StorageProvider {
    return new StorageProvider({ ...entity, address: entity.address as Hex });
  }
}
