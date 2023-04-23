import path from "path";
import fsExtraPkg from "fs-extra";
const { ensureDir, writeJSON } = fsExtraPkg;
import { Sequelize } from "sequelize";
import initModels from "./models/init-models.js";


import {
    ArcResource,
    DObject,
    DObjectVersion,
    EntityArchivalRelationship,
    EntityDobjectRelationship,
    EntityFunctionRelationship,
    Entity,
    Function,
    PubResource,
    RelatedEntity,
    RelatedResource,
} from "./exporters/index.js";

import lodashPkg from "lodash";
const { isArray, union, clone } = lodashPkg;
import { ROCrate } from "ro-crate";
import * as configuration from "./configuration.js";
import yargs from "yargs/yargs";
const argv = yargs(process.argv.slice(2))
    .scriptName("ohrm-jsonld-converter")
    .usage("Usage: $0 -o output path")
    .option("o", {
        alias: "output-path",
        describe: "A path to output the JSON-LD files",
        type: "string",
    })
    .option("v", {
        alias: "vocab-crate",
        describe: "A path to an RO-Crate containing vocabulary terms",
        type: "string",
    })
    .option("n", {
        alias: "namespace",
        describe: "A URL for the vocabulary terms (they will be added using a # reference)",
        type: "string",
    })
    .help().argv;




main();
async function main() {

    function addSuperclasses(className) {
        const c = vocabCrate.getEntity(className["@id"]);
        c.name = c["rdfs:label"];
        if (c["rdfs:subClassOf"] && isArray(c["rdfs:subClassOf"])) {
            c["rdfs:subClassOf"] = c["rdfs:subClassOf"].map((s) => {
                const superURL = s["@id"].replace(/^schema:/, "http://schema.org/");
                if (!vocabCrate.getEntity(superURL)) {
                    const sc = schemaOrgCrate.getEntity(superURL);
                    vocabCrate.addEntity(sc);
                    addSuperclasses(sc);
                }
                return { "@id": superURL }
            })
            //console.log(c["rdfs:subClassOf"]);
        }
    }
    let sequelize = new Sequelize(
        configuration.databaseConfig.database,
        configuration.databaseConfig.username,
        configuration.databaseConfig.database,
        {
            host: configuration.databaseConfig.host,
            dialect: "postgres",
            logging: false,
        }
    );
    try {
        await sequelize.authenticate();
    } catch (error) {
        console.error(`Unable to connect to the database!`);
    }
    let models = initModels(sequelize);

    if (argv.outputPath) await ensureDir(argv.outputPath);

    const crate = new ROCrate({ array: true, link: true });
    const vocabCrate = new ROCrate({ array: true, link: true });
    const schemaOrgCrate = new ROCrate({ array: true, link: true });


    const ns = argv.namespace;
    const vocabCratePath = argv.vocabCrate;
    const extractVocab = ns && vocabCratePath;
    if (extractVocab) {
        // Graba  copy of this and put it in schema.json: https://schema.org/version/latest/schemaorg-current-http.jsonld
        const schemaJson = await fsExtraPkg.readJSON("schema.json");
        for (let entity of schemaJson["@graph"]) {
            entity["@id"] = entity["@id"].replace(/^schema:/, "http://schema.org/")
            schemaOrgCrate.addEntity(clone(entity))
        }
    }









    // the name property is where those entities will be attached to the root dataset
    //   so for example: ArchivalResources will be at crate.rootDataset.archivalResource

    // TODO: (ptsefton) This might be better done with a generic hasPart relationship -- avoid a lot of extra props

    const resources = [
        { obj: ArcResource, name: "archivalResources" },
        { obj: DObject, name: "digitalObjects" },
        { obj: DObjectVersion, name: "digitalObjectVersions" },
        { obj: EntityArchivalRelationship, name: "entityArchivalRelationships" },
        { obj: EntityDobjectRelationship, name: "entityDobjectRelationships" },
        { obj: EntityFunctionRelationship, name: "entityFunctionRelationships" },
        { obj: Entity, name: "entities" },
        { obj: Function, name: "entityFunction" },
        { obj: PubResource, name: "publishedResources" },
        { obj: RelatedEntity, name: "entityRelationships" },
        { obj: RelatedResource, name: "resourceRelationships" },
    ];

    // run all the exporters
    for (let { obj, name } of resources) {
        let resource = new obj();
        let entities = await resource.export({ models });
        entities.forEach((entity) => crate.addEntity(entity));
        crate.rootDataset[name] = entities.map((e) => ({ "@id": e["@id"] }));
    }

    // iterate over all entities of type Relationship and link the entity
    //   back to the related entities
    var i =0;
    const propTargets = {};
    const extraContext = {};
    // PT: Added more informative names
    for (let entity of crate.entities()) {

        // Check that all the Properties and Classes needed are included
        if (extractVocab) {
            for (let t of entity["@type"]) {
                const resolvedTerm = vocabCrate.resolveTerm(t);
                
                if (!resolvedTerm) {
                    const newClass = {
                        "@id": `${ns}#${t}`,
                        "@type": "rdfs:Class",
                        "name": t,
                        "rdfs:label": t,
                        "rdfs:comment": "..."
                    }
                    if (entity["@type"].includes("Relationship") && t != "Relationship") {
                        newClass.subClassOf = { "@id": `${ns}#Relationship` }
                    }
                    vocabCrate.addEntity(newClass);
                    extraContext[t] = newClass["@id"];

                    vocabCrate.addValues(crate.rootDataset, "mentions", newClass);
                    // TODO: Add to @context
                    //console.log("Resolved:", t, resolvedTerm);
                }
            }
            for (let p of Object.keys(entity)) {
                // Is this prop known to our vocab crate?
                var resolvedTerm = vocabCrate.resolveTerm(p);
                if (!p.startsWith("@") && !resolvedTerm) {
                    // No - make one
                    //console.log("Making a new prop", p)
                    const newProp = {
                        "@id": `${ns}#${p}`,
                        "@type": "rdf:Property",
                        "name": p,
                        "rdfs:label": p,
                        "rdfs:comment": "...",
                        "rangeIncludes": [],
                    }
                    vocabCrate.addEntity(newProp);
                    extraContext[p] = newProp["@id"];
                    vocabCrate.addValues(crate.rootDataset, "mentions", newProp);
                    resolvedTerm = newProp["@id"];
                    // TODO: Add to @context
                    //console.log("Resolved:", t, resolvedTerm);
                }
                const propDef = vocabCrate.getEntity(resolvedTerm);

                if (propDef) {
                    if (!propTargets[resolvedTerm]) {
                        propTargets[resolvedTerm] = {}
                    }

                    propDef.domainIncludes = union(propDef.domainIncludes, entity["@type"].map((t) => {
                        const term = vocabCrate.resolveTerm(t) || `${ns}#${t}`
                        if (term.startsWith("http://schema.org") && !vocabCrate.getEntity(term)) {
                                    const newTerm = schemaOrgCrate.getEntity(term);
                                    vocabCrate.addEntity(newTerm)
                                    addSuperclasses(newTerm)
                                }
                        return {"@id" : term }
                    }))
                   
                    vocabCrate.utils.asArray(entity[p]).map((val) => {
                        if (val["@type"]) {
                            return val["@type"].map((t) => {
                                //console.log("Adding range @type for", val["@type"], p)
                                const term = vocabCrate.resolveTerm(t) || `${ns}#${t}`;
                                propTargets[resolvedTerm][term] = true;
                                if (term.startsWith("http://schema.org") && !vocabCrate.getEntity(term)) {
                                    const newTerm = schemaOrgCrate.getEntity(term);
                                    vocabCrate.addEntity(newTerm)
                                    addSuperclasses(newTerm)
                                }
                            })


                        }
                    });


                    //console.log( propDef["rangeIncludes"] )
                }


            }



            //TODO -- work out Range

        }

        if (entity["@type"].includes("Relationship")) {
            var relationshipName = "";
            try {
                let srcEntity = crate.getEntity(entity.source[0]["@id"]);
                crate.addValues(srcEntity, "sourceOf", entity, false);
                relationshipName += `${srcEntity.name} -> `;
            } catch (error) {
                console.log(`Can't find source: ${entity.source[0]["@id"]}`);
            }
            relationshipName += `${entity["@type"]} -> `
            try {
                let tgtEntity = crate.getEntity(entity.target[0]["@id"]);
                crate.addValues(tgtEntity, "targetOf", entity, false);
                relationshipName += `${tgtEntity.name}`
            } catch (error) {
                console.log(`Can't find target: ${entity.target[0]["@id"]}`);
            }
            entity.name = relationshipName;
            if (entity["@type"].length > 1) {
                entity["@type"] = entity["@type"].filter(x => x != "Relationship");
            }
        }

    }
    crate.addContext(extraContext);
    vocabCrate.addContext(extraContext);

    
    console.log(extraContext)
   
    if (argv.outputPath) {
        await ensureDir(argv.outputPath);
        await writeJSON(path.join(argv.outputPath, "ro-crate-metadata.json"), crate, { spaces: 4 });
    } else {
        console.log(JSON.stringify(crate.toJSON(), null, 2));
    }
    if (extractVocab) {
        console.log(propTargets);
        for (let p of Object.keys(propTargets)) {
            const propDef = vocabCrate.getEntity(p);
            propDef.rangeIncludes = Object.keys(propTargets[p]).map(
                (term) => {
                    return {"@id": term }
                })
        }
        await ensureDir(argv.vocabCrate);
        await writeJSON(path.join(argv.vocabCrate, "ro-crate-metadata.json"), vocabCrate, { spaces: 4 });
    }

    await sequelize.close();
    process.exit();
}
