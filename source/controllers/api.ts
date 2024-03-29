import { Request, Response, NextFunction } from "express";
import axios, { AxiosResponse } from "axios";
import * as fs from "fs";
import dotenv from 'dotenv';
import { BusStop, Service, Bus, Route, Leg, Step, Details, Line, Mode, Map, JSONObject, JSONArray } from '../types'

dotenv.config();

const busStops = JSON.parse(fs.readFileSync("source/assets/stops.json", "utf-8"));
const busFareTable = JSON.parse(fs.readFileSync("source/assets/bus_fares.json", "utf-8"))
const mrtFareTable = JSON.parse(fs.readFileSync("source/assets/mrt_fares.json", "utf-8"))

const busFareOffset : Map<number> = {
  adult : 60,
  student : 30,
  senior : 45,
  workfare : 30,
  disability : 45
}

const busFareTypes : Map<string> = {
  adult : "adult_card_fare_per_ride",
  student : "student_card_fare_per_ride",
  senior : "senior_citizen_card_fare_per_ride",
  workfare : "workfare_transport_concession_card_fare_per_ride",
  disability : "persons_with_disabilities_card_fare_per_ride"
}

// #region Bus Timing API
const getNearbyStops = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const location = {
    lat: req.query.lat,
    lng: req.query.lng,
  };

  let result: AxiosResponse = await axios.get(
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json?keyword=bus+stop&location=${location.lat}%2C${location.lng}&radius=150&type=[transit_station,bus_station]&key=${process.env.PLACES_KEY}`
  );

  let busStops = [];

  for (const item of result.data.results) {
    const code = IGetBusStopCode(item.name);
    if (code === "" || code === "N") continue;

    const serviceList = await IGetBusTimings(code);
    
    const busStop = {
      location: item.geometry.location,
      name: item.name,
      code: code,
      serviceList: serviceList,
    };

    busStops.push(busStop);
  }

  return res.status(200).json(busStops);
}

const getStopsByName = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let busStops: BusStop[] = [];

  const query = req.query.stops;

  if(!query) return res.status(404).json();

  if(Array.isArray(query))
  {  
    for (let name of query) {
      if(name === "root") continue;

      const code = IGetBusStopCode(name.toString());
      const serviceList = await IGetBusTimings(code);

      const busStop: BusStop = {
        name: name.toString(),
        code: code,
        serviceList: !serviceList ? [] : serviceList,
      };

      busStops.push(busStop);
    }
  }
  else
  {
    if(query?.toString() === "root") return res.status(200).json(busStops);
    const code = IGetBusStopCode(query?.toString() || "");
    if(code === "") return res.status(200).json("invalid stop name");

    const serviceList = await IGetBusTimings(code);

    const busStop: BusStop = {
      name: query?.toString() || "",
      code: code,
      serviceList: !serviceList ? [] : serviceList,
    };

    busStops.push(busStop);
  }

  return res.status(200).json(busStops);
}

const getStopsByCode = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let busStops: BusStop[] = [];

  const query = req.query.stops;

  if(Array.isArray(query)){
    for (let code of query) {
      const name = IGetBusStopName(code.toString());
      const serviceList = await IGetBusTimings(code.toString());

      const busStop: BusStop = {
        name: name,
        code: code.toString(),
        serviceList: serviceList?? []
      };

      busStops.push(busStop);
    }
  }
  else{
    if (!query) return;
    const name = IGetBusStopName(query.toString());
    const serviceList = await IGetBusTimings(query.toString());

    const busStop: BusStop = {
      name: name,
      code: query.toString(),
      serviceList: serviceList?? []
    };

    busStops.push(busStop);
  }

  return res.status(200).json(busStops);
}

const getBusTimings = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const busStopCode = req.query.code;

  let result: AxiosResponse = await axios.get(
    `http://datamall2.mytransport.sg/ltaodataservice/BusArrivalv2?BusStopCode=${busStopCode}`,
    {
      headers: {
        AccountKey: process.env.LTA_KEY?.toString() || "",
      },
    }
  );

  let serviceList: Service[] = [];

  const services = result.data.Services;

  if (services.length < 0) return;

  services.forEach((item: any) => {
    const serviceNo = item.ServiceNo;
    let busList: Bus[] = [];
    for (let i = 0; i < 3; i++) {
      const busNo = i <= 0 ? "NextBus" : `NextBus${i + 1}`;
      const resBus = item[busNo];
      if (resBus.EstimatedArrival.length <= 0) continue;

      const estimatedTime = new Date(resBus.EstimatedArrival);

      const estTimeInMinutes = Math.round((estimatedTime.getTime() - new Date().getTime()) / 60000)
      const estTime = estTimeInMinutes < 2 ? "Arr" : `${estTimeInMinutes} mins`;

      const bus: Bus = {
        estimatedTime: estTime,
        load: resBus.Load,
        feature: resBus.Feature,
        type: resBus.Type,
      };

      busList.push(bus);
    }

    const service: Service = {
      serviceNo: serviceNo,
      busList: busList,
    };

    serviceList.push(service);
  });

  return res.status(200).json(serviceList);
}

// #endregion

// #region Routes API
const getRoute = async(
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const originStringArray = req.query.origin?.toString().split(",") || "";
  const destinationStringArray = req.query.destination?.toString().split(",") || "";

  const origin = {
    lat: originStringArray[0],
    lng: originStringArray[1]
  }
  
  const dest = {
    lat: destinationStringArray[0],
    lng: destinationStringArray[1]
  }

  const result : AxiosResponse = await axios.get(
    `https://maps.googleapis.com/maps/api/directions/json`, {
      params: {
        origin: `${origin.lat} ${origin.lng}`,
        destination: `${dest.lat} ${dest.lng}`,
        key: process.env.DIRECTIONS_KEY,
        alternatives: true,
        mode: "transit",
        units: "metric"
      }
    }
  )

  const routeList = IGetRoutes(result.data.routes);

  return res.status(200).json(routeList)
}

const getRouteByDestinationName = async(
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const originStringArray = req.query.origin?.toString().split(",") || "";
  const dest = req.query.destination?.toString() || "";

  const origin = {
    lat: originStringArray[0],
    lng: originStringArray[1]
  }

  const result : AxiosResponse = await axios.get(
    `https://maps.googleapis.com/maps/api/directions/json`, {
      params: {
        origin: `${origin.lat} ${origin.lng}`,
        destination: dest,
        key: process.env.DIRECTIONS_KEY,
        alternatives: true,
        mode: "transit",
        units: "metric"
      }
    }
  )

  const routeList = IGetRoutes(result.data.routes);

  return res.status(200).json(routeList)
}

const getRouteByName = async(
  req: Request,
  res: Response,
  next: NextFunction
) => {
    const origin = req.query.origin?.toString || "";
    const dest = req.query.destination?.toString || "";
  
    const result : AxiosResponse = await axios.get(
      `https://maps.googleapis.com/maps/api/directions/json`, {
        params: {
          origin: origin,
          destination: dest,
          key: process.env.DIRECTIONS_KEY,
          alternatives: true,
          mode: "transit",
          units: "metric"
        }
      }
    )
  
    const routeList = IGetRoutes(result.data.routes);
  
    return res.status(200).json(routeList)
}
// #endregion

// #region Utility API
const getBusStopName = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {

  const query = req.query.stops;

  let codeList = [];

  if (!Array.isArray(query)) return res.status(200).json([IGetBusStopCode(query?.toString() || "")])

  for (const stopName of query){
    const stopCode = IGetBusStopCode(stopName.toString());
    codeList.push(stopCode);
  }

  return res.status(200).json(codeList)
}

const getFare = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {

  const query = req.query.trips;
  const fType = req.query.fareType?.toString() || 'adult';

  const fareType = busFareTypes[fType]
  const offset = busFareOffset[fType]

  let fareList = [];

  if(!query) return res.status(404).json("missing trips query param")
  if(!fType) return res.status(404).json("missing trip fare type query param")

  if (!Array.isArray(query)) {
    const [distance, tripType] = query.toString().split("_");

    if (tripType == "BUS")
    {
      const id = Math.ceil(Math.abs(parseFloat(distance) - 2.2)) - 1;
      const fareRecord = busFareTable[id];
      const fare = fareRecord[fareType] - offset;
      fareList.push(fare);
    }

    if (tripType == "MRT")
    {
      const isAdultFare = fType == "adult";
      const id = Math.ceil(Math.abs(parseFloat(distance) - 2.2)) - 1 + (isAdultFare ? 39 : 0) ;
      const fareRecord = mrtFareTable[id]
      const fare = parseInt(fareRecord.fare_per_ride)
      fareList.push(fare);
    }
  }
  else {
    for (const trip of query){
      const [distance, tripType] = trip.toString().split("_");
  
      if (tripType == "BUS")
      {
        const id = Math.ceil(Math.abs(parseFloat(distance) - 2.2)) - 1;
        const fareRecord = busFareTable[id];
        const fare = fareRecord[fareType] - offset;
        fareList.push(fare);
      }
  
      if (tripType == "MRT")
      {
        const isAdultFare = fType == "adult";
        const id = Math.ceil(Math.abs(parseFloat(distance) - 2.2)) - 1 + (isAdultFare ? 39 : 0) ;
        const fareRecord = mrtFareTable[id]
        const fare = parseInt(fareRecord.fare_per_ride)
        fareList.push(fare);
      }
    }
  }

  const totalFare = fareList.reduce((partial, current) => partial + current, 0).toString()

  return res.status(200).json(totalFare);
}
// #endregion

// #region Internal methods
const IGetBusStopName = (busStopCode: string): string => {
  return busStops.find((busStop: JSONObject) => busStop.code === busStopCode).name
};

const IGetBusStopCode = (busStopName: string): string => {
  return busStops.find((busStop: JSONObject) => busStop.name === busStopName).code
};

const IGetRoutes = (routesResponse: any): Route[] => {
  let routeList: Route[] = [];
  let legList: Leg[] = [];
  let stepList: Step[] = [];

  for (const routeItem of routesResponse)
  {
    let totalDuration = 0;
    legList = [];
    for (const legItem of routeItem.legs)
    { 
      stepList = [];
      for (const stepItem of legItem.steps)
      {
        const isTransit = stepItem.travel_mode === "TRANSIT";
        let transitDetails: Details;
        let mode: Mode = Mode.WALKING;
        let distance = stepItem.distance.text;

        if (isTransit)
        {
          const transitDetailsRes = stepItem.transit_details
          let type = transitDetailsRes.line.vehicle.type;
          let name = transitDetailsRes.line.name;

          if(transitDetailsRes.line.name.includes("Line")) 
          {
            mode = Mode.MRT;
            name = name.slice(0,-5);
          }
          if(transitDetailsRes.line.name.includes("LRT"))
          {
            mode = Mode.LRT;
            name = name.slice(0,-4);
          }
          if(transitDetailsRes.line.vehicle.type === "BUS")
          {
            mode = Mode.BUS;
          }

          const line: Line = {
            name: name,
            type: type
          }

          transitDetails = {
            arrTime: transitDetailsRes.arrival_time.text,
            from: transitDetailsRes.departure_stop.name,
            to: transitDetailsRes.arrival_stop.name,
            num_stops : transitDetailsRes.num_stops,
            line: line
          }
        }
        else
        {
          transitDetails = {
            to: stepItem.html_instructions.slice(8).replace(/, Singapore(?: \d{6})?/, "")
          }

          const isInKM = distance.slice(-2) === "km";
          distance = isInKM ? distance : `0.0${distance.slice(0, 1)} km`
        }

        const step: Step = {
          distance: distance,
          duration: stepItem.duration.text,
          mode: mode,
          details : transitDetails
        }
        
        stepList.push(step);
      }

      totalDuration += legItem.duration.value;

      const isSingleStep = stepList.length <= 1;

      const leg: Leg = {
        dptTime : !isSingleStep ? legItem.departure_time.text : "",
        arrTime : !isSingleStep ? legItem.arrival_time.text : "",
        distance: legItem.distance.text,
        duration: legItem.duration.text,
        steps: stepList
      }

      legList.push(leg);
    }

    const route: Route = {
      duration: secondsToHm(totalDuration),
      legs: legList
    }

    routeList.push(route);
  }

  return routeList;
}

const IGetBusTimings = async (busStopCode: String): Promise<Service[] | undefined>  => {
  if (busStopCode.length <= 0) return;

  let result: AxiosResponse = await axios.get(
    `http://datamall2.mytransport.sg/ltaodataservice/BusArrivalv2?BusStopCode=${busStopCode}`,
    {
      headers: {
        AccountKey: process.env.LTA_KEY?.toString() || "",
      },
    }
  );

  let serviceList: Service[] = [];

  const services = result.data.Services;

  if (services.length <= 0) return serviceList;

  services.forEach((item: any) => {
    const serviceNo = item.ServiceNo;
    let busList: Bus[] = [];
    for (let i = 0; i < 3; i++) {
      const busNo = i <= 0 ? "NextBus" : `NextBus${i + 1}`;
      const resBus = item[busNo];
      if (resBus.EstimatedArrival.length <= 0) continue;

      const estimatedTime = new Date(resBus.EstimatedArrival);
      const estTimeInMinutes = Math.round((estimatedTime.getTime() - new Date().getTime()) / 60000)
      const estTime = estTimeInMinutes < 2 ? "Arr" : `${estTimeInMinutes} mins`;

      const bus: Bus = {
        estimatedTime: estTime,
        load: resBus.Load,
        feature: resBus.Feature,
        type: resBus.Type,
      };

      busList.push(bus);
    }
    const service: Service = {
      serviceNo: serviceNo,
      busList: busList,
    };

    serviceList.push(service);
  });

  return serviceList;
};

function secondsToHm(d : number) {
  const h = Math.floor(d / 3600);
  const m = Math.round(d % 3600 / 60);

  const hDisplay = h > 0 ? `${h} hr `: "";
  const mDisplay = m > 0 ? `${m} min` : "";
  return hDisplay + mDisplay; 
}

const ping = async(
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const msg = `${Date.now().toString()} Ping Received`
  return res.status(200).json(msg)
}
// #endregion 

export default { getNearbyStops, getBusTimings, getStopsByName, getStopsByCode, getRoute, getRouteByDestinationName, getRouteByName, getBusStopName, getFare, ping};